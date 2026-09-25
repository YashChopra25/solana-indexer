'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface PollState<T> {
  data: T | null;
  error: string | null;
  /** True only until the first response arrives; later refreshes are silent. */
  loading: boolean;
  /**
   * The last read failed but earlier data is still on screen. Pages keep
   * showing that data and say it may be out of date, rather than blanking a
   * table because one request dropped.
   */
  stale: boolean;
}

/** A request slower than this is treated as failed, so a hung API shows up. */
const TIMEOUT_MS = 8_000;

/**
 * Polls a JSON endpoint on an interval. The console has no push channel, and a
 * short poll is a better fit for a local project than a websocket layer.
 *
 * Polling pauses while the tab is hidden, so a console left in a background tab
 * does not keep querying Postgres, and refreshes as soon as it is shown again.
 */
export function usePoll<T>(url: string, intervalMs = 2_000): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Kept in a ref so an in-flight request from a previous url is ignored rather
  // than overwriting fresher state.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;

    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // An error page from a proxy is not JSON; fall back to the status code.
      const body = await response.json().catch(() => null);

      if (id !== requestId.current) return;

      if (response.status >= 500) {
        // Almost always Postgres being down locally; say how to fix it.
        setError('The server could not read the database. Is Postgres running? Try `npm run db:up`.');
      } else if (!response.ok) {
        setError(body?.error ?? `The server answered with an error (${response.status}).`);
      } else {
        setData(body as T);
        setError(null);
      }
    } catch (err) {
      if (id !== requestId.current) return;

      setError(
        err instanceof DOMException && err.name === 'TimeoutError'
          ? 'The server is taking too long to answer.'
          : 'Cannot reach the server. Is `npm run dev` running?',
      );
    }
  }, [url]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      // The first read is queued rather than run inline: the effect's job is to
      // subscribe, and deferring lets the browser paint the empty state first.
      queueMicrotask(() => void load());
      timer ??= setInterval(() => void load(), intervalMs);
    };

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, intervalMs]);

  // Derived rather than stored: "nothing has come back yet" is exactly the
  // absence of both a result and an error, and needs no separate state.
  return {
    data,
    error,
    loading: data === null && error === null,
    stale: data !== null && error !== null,
  };
}
