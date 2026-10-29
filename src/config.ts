import { SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from './chain/programs';

/**
 * Every value this project reads from the environment, in one place.
 * `.env.example` documents each one. The defaults are chosen so the only
 * variable you have to set is HELIUS_API_KEY.
 */

/** Matches the postgres service in docker-compose.yml. */
export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://indexer:indexer@localhost:5432/solana_indexer';

/** Connections per process. The web app and the worker each have their own pool. */
export const DB_POOL_MAX = readCount('DB_POOL_MAX', 10);

/**
 * The longest any one statement may run.
 *
 * Short for the web app: an API read that takes longer than this is too broad
 * to be worth finishing, and every second it holds a connection is a second
 * the other callers -- the proxy's key check included -- queue behind it.
 * Generous for the worker, whose commit of a fifty-slot chunk is one statement
 * per table; anything slower than that is stuck, not busy.
 */
export const DB_STATEMENT_TIMEOUT_MS = readCount('DB_STATEMENT_TIMEOUT_MS', 5_000);
export const WORKER_STATEMENT_TIMEOUT_MS = readCount('WORKER_STATEMENT_TIMEOUT_MS', 60_000);

export const LASERSTREAM_ENDPOINT =
  process.env.LASERSTREAM_ENDPOINT ?? 'https://laserstream-mainnet-ewr.helius-rpc.com';

const COMMITMENTS = ['processed', 'confirmed', 'finalized'] as const;

/**
 * The stream's commitment level. Checked rather than cast: a typo used to reach
 * the stream as `undefined`, which quietly means the server's default.
 * `processed` is refused because nothing here rolls back a dropped fork, so its
 * rows would stay forever.
 *
 * A function, so only the worker -- the one process that streams -- fails on a
 * bad value; the web app never asks.
 */
export function streamCommitment(): 'confirmed' | 'finalized' {
  const value = process.env.COMMITMENT;
  const commitment = (value ?? 'confirmed').trim().toLowerCase();

  if (!(COMMITMENTS as readonly string[]).includes(commitment)) {
    throw new Error(`COMMITMENT must be one of: confirmed, finalized (got "${value}")`);
  }
  if (commitment === 'processed') {
    throw new Error('COMMITMENT=processed is not supported: forks that get dropped are never rolled back');
  }

  return commitment as 'confirmed' | 'finalized';
}

/** A whole number from the environment, at least `min`, or the default. */
function readCount(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be a whole number of at least ${min} (got "${raw}")`);
  }
  return value;
}

/**
 * A transaction is ingested if it touches one of these programs.
 *
 * The default three -- System, SPL Token and Token-2022 -- cover every SOL and
 * token movement, which is also every swap: a swap is detected from balance
 * changes, and a balance cannot change without one of them being involved.
 * Adding a DEX's program id here narrows nothing -- it is already covered --
 * but adding an unrelated program (a governance or NFT program, say) brings its
 * events in too.
 *
 * Empty means everything, which is far more volume than a laptop wants.
 */
export const TRACKED_PROGRAM_IDS = (
  process.env.TRACKED_PROGRAM_IDS ?? `${SYSTEM_PROGRAM},${TOKEN_PROGRAM},${TOKEN_2022_PROGRAM}`
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
 * The operator's password for /admin. Customers never use it: they call the
 * API with keys from `npm run admin`. Unset means nobody can sign in, in every
 * environment -- a forgotten variable locks /admin rather than opening it.
 * `npm run admin` works without it.
 */
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;

export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Signs the console cookie. Optional: without it the cookie is signed with a
 * key derived from ADMIN_PASSWORD. Set it to sign the two independently, so
 * changing the password does not reset every visitor's watchlist ownership.
 */
export const APP_SECRET = process.env.APP_SECRET?.trim() || null;

/**
 * Where customers reach this site, such as https://indexer.example.com. Used
 * for redirects and the URLs in /docs. Unset, they are worked out from each
 * request's Host header, which is fine until something in front rewrites it.
 */
export const PUBLIC_URL = process.env.PUBLIC_URL?.trim().replace(/\/+$/, '') || null;

/**
 * How often the worker re-reads the watchlist.
 *
 * This is the whole channel between a browser and the worker, so it decides how
 * long "watch this program" takes to reach the stream. A few seconds is well
 * inside what a person reads as immediate, and the query is a handful of rows.
 */
export const WATCHLIST_POLL_MS = 5_000;

/**
 * Caps on the shared watchlist. Each watch is a filter on the one stream, and
 * anyone can add one, so the list has to have an end. The operator is not held
 * to the per-browser cap.
 */
export const MAX_WATCHES = readCount('MAX_WATCHES', 100);
export const MAX_WATCHES_PER_VISITOR = readCount('MAX_WATCHES_PER_VISITOR', 10);

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
export const MAX_BUFFERED_SLOTS = readCount('MAX_BUFFERED_SLOTS', 600);

/**
 * The same guard, by what actually fills the heap. The default baseline pulls
 * in thousands of transactions a slot, so a slot count alone would let the
 * buffer reach gigabytes before tripping.
 */
export const MAX_BUFFERED_TRANSACTIONS = readCount('MAX_BUFFERED_TRANSACTIONS', 150_000);

/**
 * Commit attempts in a row that may fail before the worker gives up and exits
 * for its supervisor. Failed slots are kept and retried each flush, so a short
 * database blip costs nothing; a long one ends in a clean restart from the
 * checkpoint, which is still sound.
 */
export const MAX_COMMIT_FAILURES = readCount('MAX_COMMIT_FAILURES', 15);

/**
 * How often the worker re-sends its subscription even when the watchlist has
 * not changed. Cheap insurance against a reconnect that came back with an
 * older filter.
 */
export const SUBSCRIPTION_RESYNC_MS = 5 * 60_000;

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
export const TOKEN_SYNC_INTERVAL_MS = readCount('TOKEN_SYNC_INTERVAL_MS', 60_000, 0);

/** Mints per sweep: two requests' worth, so one sweep is one short burst. */
export const TOKEN_SYNC_BATCH = 200;
