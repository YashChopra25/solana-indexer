import 'dotenv/config';
import { closePool } from './pool';
import { runMigrations } from './migrate';
import { createLogger, errorMessage } from '../lib/logger';

const log = createLogger('migrate');

/** `npm run migrate` -- the worker does this on startup too. */
runMigrations()
  .then(() => log.info('schema is up to date'))
  .catch((err) => {
    log.error('migration failed', { error: errorMessage(err) });
    process.exitCode = 1;
  })
  .finally(closePool);
