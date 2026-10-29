import { getPool, withTransaction } from './pool';
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
  /** How many browsers (or the operator) want this watch. */
  watchers: number;
  /** Whether the browser asking is one of them. */
  mine: boolean;
}

interface WatchRow {
  kind: WatchKind;
  address: string;
  label: string | null;
  added_at: Date;
  matched_count: string | number;
  last_matched_slot: number | null;
  last_matched_at: Date | null;
  watchers: string | number;
  mine: boolean;
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
    watchers: Number(row.watchers ?? 0),
    mine: Boolean(row.mine),
  };
}

/** Who is asking: a browser's console id, or the signed-in operator. */
export type Watcher = { visitor: string } | { operator: true };

/** The id stored in watch_owners for this watcher. */
function ownerId(watcher: Watcher): string {
  return 'visitor' in watcher ? watcher.visitor : 'operator';
}

/** Thrown when an add would go past a cap; the message is fit to show as-is. */
export class WatchLimitError extends Error {}

const ENTRY_COLUMNS = `w.kind, w.address, w.label, w.added_at, w.matched_count,
  w.last_matched_slot, w.last_matched_at,
  (SELECT COUNT(*) FROM watch_owners o WHERE o.kind = w.kind AND o.address = w.address) AS watchers,
  EXISTS (SELECT 1 FROM watch_owners o
          WHERE o.kind = w.kind AND o.address = w.address AND o.visitor = $1) AS mine`;

export async function listWatched(watcher: Watcher | null): Promise<WatchEntry[]> {
  const { rows } = await getPool().query<WatchRow>(
    `SELECT ${ENTRY_COLUMNS} FROM watchlist w ORDER BY w.added_at DESC`,
    [watcher ? ownerId(watcher) : null],
  );

  return rows.map(toEntry);
}

/**
 * Adds an entry for this watcher, or updates its label if it is already there.
 *
 * Two browsers watching the same program is one watch with two owners: the
 * worker only needs to know *that* something is watched. Every watch costs a
 * stream subscription, so a browser may hold at most `perVisitor` and the
 * whole list at most `total`; the operator is exempt from the first.
 */
export async function addWatched(
  watcher: Watcher,
  kind: WatchKind,
  address: string,
  label: string | null,
  caps: { total: number; perVisitor: number },
): Promise<WatchEntry> {
  return withTransaction(async (client) => {
    // Serialises adds, so two racing for the last free place cannot both win.
    await client.query('SELECT pg_advisory_xact_lock(472019332)');
    return addWatchedLocked(client, watcher, kind, address, label, caps, true);
  });
}

async function addWatchedLocked(
  client: PoolClient,
  watcher: Watcher,
  kind: WatchKind,
  address: string,
  label: string | null,
  caps: { total: number; perVisitor: number },
  mayPrune: boolean,
): Promise<WatchEntry> {
  const owner = ownerId(watcher);

  const { rows: counts } = await client.query<{ exists: boolean; total: string; mine: string }>(
    `SELECT EXISTS (SELECT 1 FROM watchlist WHERE kind = $1 AND address = $2) AS exists,
            (SELECT COUNT(*) FROM watchlist) AS total,
            (SELECT COUNT(*) FROM watch_owners WHERE visitor = $3) AS mine`,
    [kind, address, owner],
  );
  const { exists, total, mine } = counts[0];

  if (!exists && Number(total) >= caps.total) {
    // Stale claims are only cleared when the list is full, which is the only
    // time they are in anyone's way.
    if (mayPrune && (await pruneStaleClaims(client)) > 0) {
      return addWatchedLocked(client, watcher, kind, address, label, caps, false);
    }
    throw new WatchLimitError(`the watchlist is full (${caps.total} entries); try again once some are removed`);
  }
  if ('visitor' in watcher && Number(mine) >= caps.perVisitor) {
    throw new WatchLimitError(`you can watch up to ${caps.perVisitor} addresses; remove one first`);
  }

  await client.query(
    `INSERT INTO watchlist (kind, address, label)
     VALUES ($1, $2, $3)
     ON CONFLICT (kind, address) DO UPDATE SET label = COALESCE(EXCLUDED.label, watchlist.label)`,
    [kind, address, label],
  );
  await client.query(
    `INSERT INTO watch_owners (kind, address, visitor) VALUES ($1, $2, $3)
     ON CONFLICT (kind, address, visitor) DO UPDATE SET last_seen_at = NOW()`,
    [kind, address, owner],
  );

  const { rows } = await client.query<WatchRow>(
    `SELECT ${ENTRY_COLUMNS} FROM watchlist w WHERE w.kind = $2 AND w.address = $3`,
    [owner, kind, address],
  );
  return toEntry(rows[0]);
}

/** How long a browser's claim lasts without that browser coming back. */
const CLAIM_TTL = '30 days';

/** Drops expired visitor claims and the watches nobody claims any more; returns watches freed. */
async function pruneStaleClaims(client: PoolClient): Promise<number> {
  await client.query(
    `DELETE FROM watch_owners WHERE visitor <> 'operator' AND last_seen_at < NOW() - INTERVAL '${CLAIM_TTL}'`,
  );
  const { rowCount } = await client.query(
    `DELETE FROM watchlist w
     WHERE NOT EXISTS (SELECT 1 FROM watch_owners o WHERE o.kind = w.kind AND o.address = w.address)`,
  );
  return rowCount ?? 0;
}

/**
 * Marks this browser's claims as still wanted. Called when it reads the list,
 * at most once a day per claim, so polling does not turn into writes.
 */
export async function refreshClaims(visitor: string): Promise<void> {
  await getPool().query(
    `UPDATE watch_owners SET last_seen_at = NOW()
     WHERE visitor = $1 AND last_seen_at < NOW() - INTERVAL '1 day'`,
    [visitor],
  );
}

/**
 * Drops this watcher's claim on a watch, and the watch itself once nobody
 * wants it. The operator removes the watch outright, whoever added it.
 *
 * Returns whether there was anything of theirs to remove.
 */
export async function removeWatched(watcher: Watcher, kind: WatchKind, address: string): Promise<boolean> {
  if ('operator' in watcher) {
    const { rowCount } = await getPool().query(
      'DELETE FROM watchlist WHERE kind = $1 AND address = $2',
      [kind, address],
    );
    return (rowCount ?? 0) > 0;
  }

  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      'DELETE FROM watch_owners WHERE kind = $1 AND address = $2 AND visitor = $3',
      [kind, address, watcher.visitor],
    );
    if (!rowCount) return false;

    await client.query(
      `DELETE FROM watchlist w
       WHERE w.kind = $1 AND w.address = $2
         AND NOT EXISTS (SELECT 1 FROM watch_owners o WHERE o.kind = w.kind AND o.address = w.address)`,
      [kind, address],
    );
    return true;
  });
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
