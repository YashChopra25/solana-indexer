import { Pool, types, type PoolClient } from 'pg';
import {
  DATABASE_URL,
  DB_POOL_MAX,
  DB_STATEMENT_TIMEOUT_MS,
  WORKER_STATEMENT_TIMEOUT_MS,
} from '../config';

/**
 * BIGINT arrives as a string by default, to protect precision. Slots, fees and
 * block heights are nowhere near Number.MAX_SAFE_INTEGER, so turning them back
 * into numbers keeps the API responses clean.
 *
 * NUMERIC is deliberately left alone: token amounts really can exceed what a
 * JavaScript number holds, and those columns are all NUMERIC for that reason.
 */
types.setTypeParser(types.builtins.INT8, Number);

let pool: Pool | null = null;

/** Set by the worker before it first touches the database; see DB_STATEMENT_TIMEOUT_MS. */
let role: 'web' | 'worker' = 'web';

export function applyWorkerTimeouts(): void {
  role = 'worker';
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: DB_POOL_MAX,
      // A database that is down or saturated fails fast instead of making every
      // caller -- the proxy's key check included -- wait without end.
      connectionTimeoutMillis: 5_000,
      // Bounds a runaway query, and a transaction left open by a crashed
      // caller, so neither can hold a connection or a lock forever.
      statement_timeout: role === 'worker' ? WORKER_STATEMENT_TIMEOUT_MS : DB_STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: 60_000,
    });
    // An idle connection dropped by the server is emitted here rather than on a
    // query, and would take the process down if nothing were listening.
    pool.on('error', (err) => console.error('[db]', err.message));
  }

  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}

/** Runs `fn` inside one BEGIN/COMMIT, rolling back if it throws. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type { PoolClient };
