type Detail = Record<string, unknown>;

/**
 * Console logging with a scope prefix. Small on purpose: this is a local
 * development project, not something shipping logs to an aggregator.
 */
export function createLogger(scope: string) {
  const write = (stream: typeof console.log, message: string, detail?: Detail) => {
    stream(`[${scope}] ${message}${detail ? ` ${JSON.stringify(detail, bigints)}` : ''}`);
  };

  return {
    info: (message: string, detail?: Detail) => write(console.log, message, detail),
    warn: (message: string, detail?: Detail) => write(console.warn, message, detail),
    error: (message: string, detail?: Detail) => write(console.error, message, detail),
  };
}

/** Decoded chain data is full of bigints, and JSON.stringify throws on them. */
function bigints(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
