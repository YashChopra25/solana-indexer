'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface PollState<T> {
  data: T | null;
  error: string | null;
  /** True only until the first response arrives; later refreshes are silent. */
  loading: boolean;
}

/**
 * Polls a JSON endpoint on an interval. The console has no push channel, and a
 * short poll is a better fit for a local project than a websocket layer.
 *
 * Polling pauses while the tab is hidden, so a console left in a background tab
 * does not keep querying Postgres.
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
      const response = await fetch(url, { cache: 'no-store' });
      const body = await response.json();

      if (id !== requestId.current) return;

      if (!response.ok) {
        setError(body?.error ?? `request failed with ${response.status}`);
      } else {
        setData(body as T);
        setError(null);
      }
    } catch (err) {
      if (id === requestId.current) {
        setError(err instanceof Error ? err.message : 'request failed');
      }
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
  return { data, error, loading: data === null && error === null };
}
