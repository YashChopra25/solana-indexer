'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { usePoll } from '@/hooks/use-poll';
import type { WatchEntry } from '@/lib/api-types';
import {
  deleteWatched,
  isAvailable,
  listWatched,
  saveWatched,
  type WatchKind,
  type WatchedItem,
} from '@/lib/watch-store';

/**
 * The user's watchlist, and the two-step it does on every change.
 *
 * IndexedDB is the user's list; the server's table is what the worker actually
 * subscribes to. Adding writes to both — locally first, so the console responds
 * immediately, then to the server, which is what reaches the stream.
 *
 * If the server refuses an add, the local entry is taken back out and `error`
 * says why. If the server cannot be reached, the entry stays and is sent again
 * on the next page load -- see `heal`.
 */

export interface Watchlist {
  items: WatchedItem[];
  loading: boolean;
  error: string | null;
  /** Whether this browser can store a watchlist at all. */
  supported: boolean;
  isWatched(kind: WatchKind, address: string): boolean;
  watch(kind: WatchKind, address: string, label?: string | null): Promise<void>;
  unwatch(kind: WatchKind, address: string): Promise<void>;
}

/** A refusal from the server, as opposed to not reaching it at all. */
class Refused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function tellServer(method: 'POST' | 'DELETE', body: unknown): Promise<void> {
  const response = await fetch('/api/watchlist', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new Refused(problem?.error ?? `the indexer answered ${response.status}`, response.status);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}

/**
 * Re-sends local entries the server does not have for this browser.
 *
 * The two lists drift: a mirror call fails, the server row is removed by the
 * operator, or the cookie that names this browser is cleared. Once per page
 * load is enough to bring them back together without anyone noticing.
 *
 * Returns whether it dropped any local entries the server will never take.
 */
async function heal(items: WatchedItem[]): Promise<boolean> {
  let removed = false;
  if (items.length === 0) return removed;

  const response = await fetch('/api/watchlist', { cache: 'no-store' });
  if (!response.ok) return removed;

  const { data } = (await response.json()) as { data: WatchEntry[] };
  const mine = new Set(data.filter((entry) => entry.mine).map((e) => `${e.kind}:${e.address}`));

  for (const item of items) {
    if (mine.has(`${item.kind}:${item.address}`)) continue;

    try {
      await tellServer('POST', { kind: item.kind, address: item.address, label: item.label });
    } catch (err) {
      if (!(err instanceof Refused)) return removed; // Unreachable: try again next load.
      // Slowed down: stop, so the person's own next click is not the one refused.
      if (err.status === 429) return removed;
      // Refused for good (a cap, a program that cannot be watched): drop the
      // local copy rather than ask again on every page.
      await deleteWatched(item.kind, item.address).catch(() => {});
      removed = true;
    }
  }

  return removed;
}

/** Nothing to subscribe to: whether IndexedDB exists never changes at runtime. */
const noop = () => () => {};

export function useWatchlist(): Watchlist {
  /**
   * Read through `useSyncExternalStore` rather than called directly, because
   * the answer differs between the server (no IndexedDB) and the browser. React
   * uses the server snapshot to hydrate and then re-renders with the client
   * one, which is exactly the handover a bare `typeof indexedDB` check gets
   * wrong -- it renders two different trees and fails hydration.
   */
  const supported = useSyncExternalStore(noop, isAvailable, () => false);

  const [items, setItems] = useState<WatchedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<WatchedItem[]> => {
    try {
      const next = await listWatched();
      setItems(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not read the watchlist');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Queued rather than run inline, the same way `usePoll` does its first
    // read: the effect's job is to subscribe, and deferring lets the browser
    // paint the empty list before IndexedDB is opened.
    queueMicrotask(
      () =>
        void reload()
          .then(heal)
          .then((removed) => (removed ? reload() : undefined))
          .catch(() => {}),
    );
  }, [reload]);

  const watch = useCallback(
    async (kind: WatchKind, address: string, label: string | null = null) => {
      setError(null);

      const item: WatchedItem = { kind, address, label, addedAt: Date.now() };

      try {
        await saveWatched(item);
      } catch (err) {
        setError(`This browser could not save it: ${describe(err)}`);
        return;
      }
      await reload();

      try {
        await tellServer('POST', { kind, address, label });
      } catch (err) {
        if (err instanceof Refused) {
          // The server said no (a full list, a bad address): keeping it here
          // would show a watch the indexer will never have.
          await deleteWatched(kind, address).catch(() => {});
          await reload();
          setError(`Not watched: ${err.message}`);
        } else {
          // Unreachable: keep it, and the next page load sends it again.
          setError(`Saved here; the indexer will be told when it is reachable (${describe(err)}).`);
        }
      }
    },
    [reload],
  );

  const unwatch = useCallback(
    async (kind: WatchKind, address: string) => {
      setError(null);

      try {
        await deleteWatched(kind, address);
      } catch (err) {
        setError(`This browser could not remove it: ${describe(err)}`);
        return;
      }
      await reload();

      try {
        await tellServer('DELETE', { kind, address });
      } catch (err) {
        // A 404 means the server had already forgotten it, which is the state
        // we wanted anyway -- only report something that still needs attention.
        const message = describe(err);
        if (!(err instanceof Refused && err.status === 404)) {
          setError(`Removed here, but the indexer still has it: ${message}`);
        }
      }
    },
    [reload],
  );

  const isWatched = useCallback(
    (kind: WatchKind, address: string) =>
      items.some((item) => item.kind === kind && item.address === address),
    [items],
  );

  return { items, loading, error, supported, isWatched, watch, unwatch };
}

/**
 * What the *indexer* knows about one watch, as opposed to what this browser
 * does.
 *
 * The two can differ — another browser may have added it, or the mirror to the
 * server may have failed — and anything describing the subscription has to read
 * the server's answer. Polled once per page and shared, rather than fetched
 * again by each component that needs it.
 */
export function useWatchEntry(kind: WatchKind, address: string): WatchEntry | null {
  const registry = usePoll<{ data: WatchEntry[] }>('/api/watchlist', 10_000);

  return (
    registry.data?.data.find((entry) => entry.kind === kind && entry.address === address) ?? null
  );
}
