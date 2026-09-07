import 'dotenv/config';
import { closePool } from './store/pool';
import { runMigrations } from './store/migrate';
import { Indexer } from './core/indexer';
import { COMMITMENT, LASERSTREAM_ENDPOINT, TRACKED_PROGRAM_IDS } from './config';
import { createLogger, errorMessage } from './lib/logger';

const log = createLogger('worker');

/**
 * The ingestion worker: `npm run indexer`.
 *
 * It runs as its own process next to the Next.js server, and the two only ever
 * meet in Postgres. Neither needs the other to start.
 */
async function main() {
  await runMigrations();

  const controller = new AbortController();
  const stop = (signal: string) => {
    log.info('shutting down', { signal });
    controller.abort();
  };

  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  const indexer = new Indexer();

  // A quiet stream and a stalled one look identical without this.
  const heartbeat = setInterval(() => log.info('status', indexer.getStats()), 30_000);

  log.info('starting', {
    endpoint: LASERSTREAM_ENDPOINT,
    commitment: COMMITMENT,
    programs: TRACKED_PROGRAM_IDS,
  });

  try {
    await indexer.run(controller.signal);
  } finally {
    clearInterval(heartbeat);
    await closePool();
    log.info('stopped', indexer.getStats());
  }

  // Stopping because we could not keep up is a failure, even though the
  // shutdown itself was clean. Exit non-zero so a supervisor restarts us -- and
  // a restart is all it takes, because the checkpoint is sound.
  if (indexer.overloaded) process.exitCode = 1;
}

main().catch((err) => {
  log.error('worker exited', { error: errorMessage(err) });
  process.exit(1);
});
