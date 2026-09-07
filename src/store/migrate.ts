import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getPool } from './pool';
import { createLogger } from '../lib/logger';

const log = createLogger('migrate');

/**
 * Applies every .sql file in migrations/ in filename order, and remembers which
 * ones already ran. Both the worker and `npm run migrate` call this, so the
 * schema is in place before anything touches it.
 */
export async function runMigrations(): Promise<void> {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));

  const dir = path.join(process.cwd(), 'migrations');
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();

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
    } finally {
      client.release();
    }
  }
}
