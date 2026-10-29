import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getPool, type PoolClient } from './pool';
import { createLogger } from '../lib/logger';

const log = createLogger('migrate');

/**
 * Applies every .sql file in migrations/ in filename order, and remembers which
 * ones already ran. Both the worker and `npm run migrate` call this, so the
 * schema is in place before anything touches it.
 */
export async function runMigrations(): Promise<void> {
  // One session holds this lock for the whole run, so the worker and
  // `npm run migrate` starting together take turns instead of racing to apply
  // the same file. The number is arbitrary; it only has to be this project's.
  // Everything runs on that one connection, so a pool of one is enough, and
  // its time limit is lifted: waiting behind a long migration, or running one,
  // is not a query gone wrong.
  const client = await getPool().connect();

  try {
    await client.query('SET statement_timeout = 0');
    await client.query('SELECT pg_advisory_lock(472019331)');
    await applyPending(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock(472019331)').catch(() => {});
    // Handed back to the pool with the usual limit in force again.
    await client.query('RESET statement_timeout').catch(() => {});
    client.release();
  }
}

async function applyPending(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));

  const dir = path.join(process.cwd(), 'migrations');
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(path.join(dir, file), 'utf8');

    try {
      // The schema change and its bookkeeping row commit together, so a
      // migration that fails halfway is not recorded as done.
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log.info('applied', { file });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  }
}
