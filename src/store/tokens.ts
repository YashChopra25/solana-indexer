import { getPool } from './pool';
import type { TokenMeta } from '../chain/token-list';

/**
 * Reading and writing the symbol columns on `tokens`.
 *
 * Kept apart from `read.ts` and `write.ts` because this is the one thing in the
 * project that is neither on the indexing path nor answering a request: it is a
 * background sweep, and it is the only code that talks to the network.
 */

/**
 * Mints nobody has looked up yet, newest first.
 *
 * Newest first because a mint the indexer met a minute ago is far likelier to
 * be on a page someone is looking at than one from a slot long since scrolled
 * past. The partial index in migration 005 covers exactly this predicate.
 */
export async function findUncheckedMints(limit: number): Promise<string[]> {
  const { rows } = await getPool().query<{ mint: string }>(
    `SELECT mint FROM tokens
     WHERE checked_at IS NULL
     ORDER BY first_seen_slot DESC NULLS LAST
     LIMIT $1`,
    [limit],
  );

  return rows.map((row) => row.mint);
}

/**
 * Records what a lookup found, and marks every mint it asked about as checked
 * — including the ones that resolved to nothing.
 *
 * Both halves matter. Storing only the hits would leave the misses looking
 * unchecked, and the next sweep would ask about the same unlisted mints again,
 * forever, never reaching the ones behind them. Marking is therefore driven by
 * `asked`, not by `found`.
 */
export async function saveTokenMeta(asked: string[], found: TokenMeta[]): Promise<number> {
  if (asked.length === 0) return 0;

  const pool = getPool();

  for (const meta of found) {
    await pool.query(
      `UPDATE tokens
       SET symbol = $2, name = $3, checked_at = NOW(), updated_at = NOW()
       WHERE mint = $1`,
      [meta.mint, meta.symbol, meta.name],
    );
  }

  // Everything asked about is now checked. The hits above already set it; this
  // catches the misses in one statement rather than one per mint.
  await pool.query(
    `UPDATE tokens SET checked_at = NOW()
     WHERE mint = ANY($1::TEXT[]) AND checked_at IS NULL`,
    [asked],
  );

  return found.length;
}

/**
 * Symbols for a set of mints, as a map.
 *
 * Looked up once per response rather than joined into each list query. The
 * alternative — a LEFT JOIN in every query that returns a mint — would mean
 * touching all of them plus the three-branch activity UNION, to save a single
 * primary-key lookup of at most a couple of hundred rows. This stays out of the
 * way of the queries that do the real work.
 */
export async function findSymbols(mints: Iterable<string>): Promise<Map<string, string>> {
  const wanted = [...new Set(mints)];
  if (wanted.length === 0) return new Map();

  const { rows } = await getPool().query<{ mint: string; symbol: string }>(
    `SELECT mint, symbol FROM tokens
     WHERE mint = ANY($1::TEXT[]) AND symbol IS NOT NULL`,
    [wanted],
  );

  return new Map(rows.map((row) => [row.mint, row.symbol]));
}

/** How far along the sweep is, for `/api/status` and the sync script. */
export async function readSymbolCoverage(): Promise<{
  total: number;
  named: number;
  unchecked: number;
}> {
  const { rows } = await getPool().query<{ total: string; named: string; unchecked: string }>(
    `SELECT count(*)                                      AS total,
            count(*) FILTER (WHERE symbol IS NOT NULL)    AS named,
            count(*) FILTER (WHERE checked_at IS NULL)    AS unchecked
     FROM tokens`,
  );

  return {
    total: Number(rows[0]?.total ?? 0),
    named: Number(rows[0]?.named ?? 0),
    unchecked: Number(rows[0]?.unchecked ?? 0),
  };
}
