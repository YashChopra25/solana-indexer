'use client';

/**
 * The watchlist as this browser knows it, in IndexedDB.
 *
 * This is the user's own list and the source of truth for what the console
 * shows them. It survives a reload and a restart, needs no account, and never
 * leaves the machine.
 *
 * The server has a list too, but it is a different thing: the union of what
 * every browser has asked the indexer to watch. This one is personal; that one
 * is what the worker subscribes to. `useWatchlist` keeps them in step.
 *
 * IndexedDB rather than localStorage because entries are records with several
 * fields and want a compound key, and because localStorage is synchronous and
 * blocks the main thread on every read.
 */

const DATABASE = 'solana-indexer';
const STORE = 'watchlist';
const VERSION = 1;

export type WatchKind = 'program' | 'wallet';

export interface WatchedItem {
  kind: WatchKind;
  address: string;
  label: string | null;
  /** When this browser added it, epoch milliseconds. */
  addedAt: number;
}

/** True in a browser that has IndexedDB, false during server rendering. */
export function isAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  // One connection per tab, reused. Opening is cheap but not free, and every
  // read would otherwise pay for it.
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE)) {
        // A compound key means one program and one wallet can share an address
        // without colliding, which is rare but legal on Solana.
        db.createObjectStore(STORE, { keyPath: ['kind', 'address'] });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('could not open IndexedDB'));
  });

  return opening;
}

/**
 * Runs one transaction and resolves with `read`'s result.
 *
 * Resolution waits for `oncomplete` rather than for the request, because a
 * write is only durable once the transaction commits — resolving earlier would
 * report success for something that can still fail.
 */
async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await open();

  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));

    tx.oncomplete = () => resolve(request.result as T);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** Everything this browser is watching, most recently added first. */
export async function listWatched(): Promise<WatchedItem[]> {
  if (!isAvailable()) return [];

  const items = await transact<WatchedItem[]>('readonly', (store) => store.getAll());

  return items.sort((a, b) => b.addedAt - a.addedAt);
}

export async function saveWatched(item: WatchedItem): Promise<void> {
  if (!isAvailable()) return;

  await transact('readwrite', (store) => store.put(item));
}

export async function deleteWatched(kind: WatchKind, address: string): Promise<void> {
  if (!isAvailable()) return;

  await transact('readwrite', (store) => store.delete([kind, address]));
}
