import { getPool } from '@/store/pool';
import { createLogger, errorMessage } from '@/lib/logger';

// Every endpoint reads live indexer state, so none can be prerendered.
export const dynamic = 'force-dynamic';

const log = createLogger('health');

/** Newer than this and the worker counts as running. Commits land every few seconds. */
const WORKER_STALE_SECONDS = 120;

/**
 * GET /api/health -- for an uptime monitor.
 *
 * 503 when Postgres cannot be reached, since then nothing works. A stalled
 * worker is reported but still answers 200: the console and API keep serving
 * what is stored. Point an alert at `worker.ok` to hear about that one.
 */
export async function GET() {
  try {
    const { rows } = await getPool().query<{ updated_at: Date | null; last_block_time: Date | null }>(
      `SELECT updated_at, last_block_time FROM indexer_state WHERE id = 'default'`,
    );

    const updatedAt = rows[0]?.updated_at ?? null;
    const sinceCommit = updatedAt ? Math.round((Date.now() - updatedAt.getTime()) / 1000) : null;
    const lastBlock = rows[0]?.last_block_time ?? null;

    return Response.json({
      status: 'ok',
      service: 'solana-indexer',
      time: new Date().toISOString(),
      database: { ok: true },
      worker: {
        ok: sinceCommit !== null && sinceCommit <= WORKER_STALE_SECONDS,
        secondsSinceLastCommit: sinceCommit,
        lagSeconds: lastBlock ? Math.round((Date.now() - lastBlock.getTime()) / 1000) : null,
      },
    });
  } catch (err) {
    log.error('health check failed', { error: errorMessage(err) });
    return Response.json(
      { status: 'unavailable', service: 'solana-indexer', database: { ok: false } },
      { status: 503 },
    );
  }
}
