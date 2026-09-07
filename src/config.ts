import { SYSTEM_PROGRAM, TOKEN_PROGRAM } from './chain/programs';

/**
 * Every value this project reads from the environment, in one place.
 * `.env.example` documents each one. The defaults are chosen so the only
 * variable you have to set is HELIUS_API_KEY.
 */

/** Matches the postgres service in docker-compose.yml. */
export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://indexer:indexer@localhost:5432/solana_indexer';

export const LASERSTREAM_ENDPOINT =
  process.env.LASERSTREAM_ENDPOINT ?? 'https://laserstream-mainnet-ewr.helius-rpc.com';

export const COMMITMENT = (process.env.COMMITMENT ?? 'confirmed') as
  | 'processed'
  | 'confirmed'
  | 'finalized';

/**
 * A transaction is ingested if it touches one of these programs.
 *
 * The default pair covers every SOL and SPL token movement, which is also every
 * swap: a swap is detected from balance changes, and a balance cannot change
 * without one of these two programs being involved. Adding a DEX's program id
 * here narrows nothing — it is already covered — but adding an unrelated
 * program (a governance or NFT program, say) brings its events in too.
 *
 * Empty means everything, which is far more volume than a laptop wants.
 */
export const TRACKED_PROGRAM_IDS = (
  process.env.TRACKED_PROGRAM_IDS ?? `${SYSTEM_PROGRAM},${TOKEN_PROGRAM}`
)
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

/** Only the worker needs a key, so the web app runs without one. */
export function heliusApiKey(): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error('HELIUS_API_KEY is not set — see .env.example');

  return key;
}

/**
 * How often the worker re-reads the watchlist.
 *
 * This is the whole channel between a browser and the worker, so it decides how
 * long "watch this program" takes to reach the stream. A few seconds is well
 * inside what a person reads as immediate, and the query is a handful of rows.
 */
export const WATCHLIST_POLL_MS = 5_000;

/** A slot is committed once the chain tip is this far past it (~10 seconds). */
export const SLOT_FLUSH_LAG = 24;

/** How often the worker sweeps the buffer for slots ready to commit. */
export const FLUSH_INTERVAL_MS = 2_000;

/**
 * How many slots go into one Postgres transaction. One is the ordinary case; a
 * larger number is what lets the worker catch up after a reconnect, when the
 * stream replays a backlog faster than one-slot-per-commit can absorb.
 */
export const SLOTS_PER_COMMIT = 50;

/**
 * Give up if this many slots are waiting to be written.
 *
 * Buffered slots hold indexed transactions in memory. If the stream keeps
 * arriving faster than Postgres can take it, the buffer grows until the process
 * runs out of heap and is killed — losing whatever was buffered and printing a
 * V8 stack trace instead of an explanation. Stopping on purpose is better: the
 * checkpoint is sound, so restarting resumes cleanly.
 */
export const MAX_BUFFERED_SLOTS = 2_000;

/**
 * How many account writes may queue between flushes.
 *
 * Watching a program subscribes to every account it owns, and a busy program
 * writes a great many of them. The queue drains every flush, so this only ever
 * bites when writes arrive faster than Postgres takes them -- at which point
 * dropping the overflow is right: an account update is a snapshot of current
 * state, so the newest is the one worth keeping and a stale one helps nobody.
 */
export const MAX_PENDING_ACCOUNT_UPDATES = 20_000;

/* ------------------------------------------------------------------ */
/* Token symbols                                                       */
/* ------------------------------------------------------------------ */

/**
 * Where mint symbols come from.
 *
 * A mint account holds decimals, not a name, so the console would otherwise
 * have nothing but the address to show. This is the one outbound HTTP call in
 * the project, it is not on the indexing path, and everything keeps working
 * when it fails -- unnamed mints simply render as shortened addresses.
 */
export const TOKEN_LIST_ENDPOINT =
  process.env.TOKEN_LIST_ENDPOINT ?? 'https://lite-api.jup.ag/tokens/v2/search';

/** Mints per request. The endpoint accepts a comma-separated list; 100 is its limit. */
export const TOKEN_LIST_BATCH = 100;

export const TOKEN_LIST_TIMEOUT_MS = 10_000;

/**
 * How often the worker looks up mints it has never checked, and how many it
 * takes at a time.
 *
 * Slow on purpose. New mints appear constantly and almost none of them are
 * listed anywhere, so this is a background sweep of a backlog that never fully
 * empties -- not something anything waits on. Set the interval to 0 to turn the
 * sweep off and rely on `npm run tokens:sync` alone.
 */
export const TOKEN_SYNC_INTERVAL_MS = Number(process.env.TOKEN_SYNC_INTERVAL_MS ?? 60_000);

/** Mints per sweep: two requests' worth, so one sweep is one short burst. */
export const TOKEN_SYNC_BATCH = 200;
