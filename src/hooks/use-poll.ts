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
  /** The HTTP status of the last failed read, so a page can tell 404 from an outage. */
  status: number | null;
}

/** A request slower than this is treated as failed, so a hung API shows up. */
const TIMEOUT_MS = 8_000;

/**
 * Polls a JSON endpoint on an interval. The console has no push channel, and a
 * short poll is a better fit for a local project than a websocket layer.
 *
 * Polling pauses while the tab is hidden, so a console left in a background tab
 * does not keep querying Postgres, and refreshes as soon as it is shown again.
 * A url of null means "nothing to ask yet" and makes no requests.
 */
export function usePoll<T>(url: string | null, intervalMs = 2_000): PollState<T> {
  // Kept with the url it belongs to, so switching filters never shows the
  // previous filter's rows under the new heading -- and without a reset effect.
  const [state, setState] = useState<{
    url: string | null;
    data: T | null;
    error: string | null;
    status: number | null;
  }>({ url, data: null, error: null, status: null });

  // Kept in a ref so an in-flight request from a previous url is ignored rather
  // than overwriting fresher state.
  const requestId = useRef(0);

  /** Reads once; resolves to how long to wait before the next read. */
  const load = useCallback(async (): Promise<number> => {
    if (url === null) return intervalMs;
    const id = ++requestId.current;

    const settle = (data: T | null, error: string | null, status: number | null = null) => {
      if (id !== requestId.current) return;
      setState((prev) => ({
        url,
        data: data ?? (prev.url === url ? prev.data : null),
        error,
        status,
      }));
    };

    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // An error page from a proxy is not JSON; fall back to the status code.
      const body = await response.json().catch(() => null);

      if (response.status === 429) {
        settle(null, 'Too many requests from this network; slowing down.', 429);
        return (Number(response.headers.get('retry-after')) || 30) * 1000;
      }
      if (response.status >= 500) {
        settle(null, 'The service is having trouble right now. Retrying…', response.status);
        return intervalMs * 2;
      }
      if (!response.ok) {
        settle(
          null,
          body?.error ?? `The server answered with an error (${response.status}).`,
          response.status,
        );
        // The same question will get the same answer; ask again rarely.
        return Math.max(intervalMs, 30_000);
      }

      settle(body as T, null);
      return intervalMs;
    } catch (err) {
      settle(
        null,
        err instanceof DOMException && err.name === 'TimeoutError'
          ? 'The server is taking too long to answer. Retrying…'
          : 'Cannot reach the server. Check your connection; retrying…',
      );
      return intervalMs * 2;
    }
  }, [url, intervalMs]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let stopped = false;

    // Each read is scheduled when the last one finishes, never on a fixed
    // beat: a slow server then gets fewer requests, not a pile of overlapping
    // ones.
    const tick = async () => {
      if (running || stopped) return;
      running = true;
      const wait = await load();
      running = false;
      if (!stopped && !document.hidden) timer = setTimeout(() => void tick(), wait);
    };

    const start = () => {
      stopped = false;
      if (timer) clearTimeout(timer);
      // The first read is queued rather than run inline: the effect's job is to
      // subscribe, and deferring lets the browser paint the empty state first.
      queueMicrotask(() => void tick());
    };

    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const onVisibility = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  const current = state.url === url;
  const data = current ? state.data : null;
  const error = current ? state.error : null;

  // Derived rather than stored: "nothing has come back yet" is exactly the
  // absence of both a result and an error, and needs no separate state.
  return {
    data,
    error,
    loading: url !== null && data === null && error === null,
    stale: data !== null && error !== null,
    status: current ? state.status : null,
  };
}
