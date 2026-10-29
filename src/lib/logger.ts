type Detail = Record<string, unknown>;
type Level = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** `LOG_LEVEL=warn` hides info lines; unknown values fall back to info. */
const THRESHOLD = RANK[(process.env.LOG_LEVEL ?? 'info').toLowerCase() as Level] ?? RANK.info;

/**
 * One JSON object per line in production, so `docker compose logs` can be fed
 * to any log tool and filtered by level or scope. Development keeps the
 * readable `[scope] message {...}` form.
 */
const AS_JSON = (process.env.LOG_FORMAT ?? (process.env.NODE_ENV === 'production' ? 'json' : 'text')) === 'json';

/** Console logging with a scope prefix. Small on purpose: no logging library. */
export function createLogger(scope: string) {
  const write = (level: Level, message: string, detail?: Detail) => {
    if (RANK[level] < THRESHOLD) return;

    const stream = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

    if (AS_JSON) {
      stream(JSON.stringify({ time: new Date().toISOString(), level, scope, message, ...detail }, bigints));
    } else {
      stream(`[${scope}] ${message}${detail ? ` ${JSON.stringify(detail, bigints)}` : ''}`);
    }
  };

  return {
    debug: (message: string, detail?: Detail) => write('debug', message, detail),
    info: (message: string, detail?: Detail) => write('info', message, detail),
    warn: (message: string, detail?: Detail) => write('warn', message, detail),
    error: (message: string, detail?: Detail) => write('error', message, detail),
  };
}

/** Decoded chain data is full of bigints, and JSON.stringify throws on them. */
function bigints(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
