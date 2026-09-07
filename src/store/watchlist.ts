import { getPool } from './pool';
import type { PoolClient } from './pool';

/**
 * The watchlist registry: what the indexer has been asked to keep an eye on.
 *
 * This is the only channel between a browser and the worker. The browser owns
 * its own list in IndexedDB and mirrors each entry here; the worker reads here
 * and never learns that IndexedDB exists.
 */

export type WatchKind = 'program' | 'wallet';

interface WatchEntry {
  kind: WatchKind;
  address: string;
  label: string | null;
  addedAt: string;
  /** How many stream updates this watch's own filter has matched. */
  matchedCount: number;
  lastMatchedSlot: number | null;
  lastMatchedAt: string | null;
}

interface WatchRow {
  kind: WatchKind;
  address: string;
  label: string | null;
  added_at: Date;
  matched_count: string | number;
  last_matched_slot: number | null;
  last_matched_at: Date | null;
}

function toEntry(row: WatchRow): WatchEntry {
  return {
    kind: row.kind,
    address: row.address,
    label: row.label,
    addedAt: new Date(row.added_at).toISOString(),
    matchedCount: Number(row.matched_count ?? 0),
    lastMatchedSlot: row.last_matched_slot,
    lastMatchedAt: row.last_matched_at ? new Date(row.last_matched_at).toISOString() : null,
  };
}

export async function listWatched(): Promise<WatchEntry[]> {
  const { rows } = await getPool().query<WatchRow>(
    `SELECT kind, address, label, added_at, matched_count, last_matched_slot, last_matched_at
     FROM watchlist ORDER BY added_at DESC`,
  );

  return rows.map(toEntry);
}

/**
 * Adds an entry, or updates its label if it is already there.
 *
 * Two browsers watching the same program is one row, not two: the worker only
 * needs to know *that* something is watched, not how many people want it.
 */
export async function addWatched(
  kind: WatchKind,
  address: string,
  label: string | null,
): Promise<WatchEntry> {
  const { rows } = await getPool().query<WatchRow>(
    `INSERT INTO watchlist (kind, address, label)
     VALUES ($1, $2, $3)
     ON CONFLICT (kind, address) DO UPDATE SET label = COALESCE(EXCLUDED.label, watchlist.label)
     RETURNING kind, address, label, added_at, matched_count, last_matched_slot, last_matched_at`,
    [kind, address, label],
  );

  return toEntry(rows[0]);
}

/** Returns whether a row was actually removed. */
export async function removeWatched(kind: WatchKind, address: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    'DELETE FROM watchlist WHERE kind = $1 AND address = $2',
    [kind, address],
  );

  return (rowCount ?? 0) > 0;
}

export interface WatchTarget {
  kind: WatchKind;
  address: string;
}

/**
 * Everything being watched, with its kind.
 *
 * The kind matters to the stream. A wallet is subscribed to by *account*: tell
 * me when this account changes. A program cannot be — a program account is
 * executable and effectively never changes, so subscribing to it by account
 * would report nothing, ever. A program is subscribed to by *owner* instead:
 * tell me when any account this program owns changes, which is its pools, its
 * state accounts, everything it actually writes.
 *
 * Takes a client so the worker can read it on its own pool without importing
 * the web app's.
 */
export async function readWatchTargets(client: {
  query: PoolClient['query'];
}): Promise<WatchTarget[]> {
  const { rows } = await client.query<{ kind: WatchKind; address: string }>(
    'SELECT kind, address FROM watchlist ORDER BY kind, address',
  );

  return rows;
}

/**
 * Records what each watch matched since the last flush.
 *
 * Counted in the worker and written in one statement rather than incremented
 * per update: a busy watch matches hundreds of updates a second, and a row
 * update each time would cost more than the indexing it is reporting on.
 */
export async function recordWatchMatches(
  client: { query: PoolClient['query'] },
  matches: Map<string, { count: number; slot: number }>,
): Promise<void> {
  for (const [key, { count, slot }] of matches) {
    // The filter name is `watch:<kind>:<address>`; the address may not contain
    // a colon, so splitting on the first two is unambiguous.
    const [, kind, address] = key.split(':');
    if (!kind || !address) continue;

    await client.query(
      `UPDATE watchlist
       SET matched_count     = matched_count + $3,
           last_matched_slot = GREATEST(COALESCE(last_matched_slot, 0), $4),
           last_matched_at   = NOW()
       WHERE kind = $1 AND address = $2`,
      [kind, address, count, slot],
    );
  }
}
