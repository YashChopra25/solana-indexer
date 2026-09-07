'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { usePoll } from '@/hooks/use-poll';
import type { WatchEntry } from '@/lib/api-types';
import {
  deleteWatched,
  isAvailable,
  listWatched,
  saveWatched,
  type WatchKind,
  type WatchedItem,
} from '@/lib/watch-store';

/**
 * The user's watchlist, and the two-step it does on every change.
 *
 * IndexedDB is the user's list; the server's table is what the worker actually
 * subscribes to. Adding writes to both — locally first, so the console responds
 * immediately, then to the server, which is what reaches the stream.
 *
 * If the server call fails the local entry stays and `error` is set. That is
 * the honest outcome: the user's list really does contain it, and the indexer
 * really is not watching it yet, so saying so beats silently dropping either
 * half.
 */

export interface Watchlist {
  items: WatchedItem[];
  loading: boolean;
  error: string | null;
  /** Whether this browser can store a watchlist at all. */
  supported: boolean;
  isWatched(kind: WatchKind, address: string): boolean;
  watch(kind: WatchKind, address: string, label?: string | null): Promise<void>;
  unwatch(kind: WatchKind, address: string): Promise<void>;
}

async function tellServer(method: 'POST' | 'DELETE', body: unknown): Promise<void> {
  const response = await fetch('/api/watchlist', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new Error(problem?.error ?? `the indexer answered ${response.status}`);
  }
}

/** Nothing to subscribe to: whether IndexedDB exists never changes at runtime. */
const noop = () => () => {};

export function useWatchlist(): Watchlist {
  /**
   * Read through `useSyncExternalStore` rather than called directly, because
   * the answer differs between the server (no IndexedDB) and the browser. React
   * uses the server snapshot to hydrate and then re-renders with the client
   * one, which is exactly the handover a bare `typeof indexedDB` check gets
   * wrong -- it renders two different trees and fails hydration.
   */
  const supported = useSyncExternalStore(noop, isAvailable, () => false);

  const [items, setItems] = useState<WatchedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await listWatched());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not read the watchlist');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Queued rather than run inline, the same way `usePoll` does its first
    // read: the effect's job is to subscribe, and deferring lets the browser
    // paint the empty list before IndexedDB is opened.
    queueMicrotask(() => void reload());
  }, [reload]);

  const watch = useCallback(
    async (kind: WatchKind, address: string, label: string | null = null) => {
      setError(null);

      const item: WatchedItem = { kind, address, label, addedAt: Date.now() };

      await saveWatched(item);
      await reload();

      try {
        await tellServer('POST', { kind, address, label });
      } catch (err) {
        setError(
          `Saved here, but the indexer was not told: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
      }
    },
    [reload],
  );

  const unwatch = useCallback(
    async (kind: WatchKind, address: string) => {
      setError(null);

      await deleteWatched(kind, address);
      await reload();

      try {
        await tellServer('DELETE', { kind, address });
      } catch (err) {
        // A 404 means the server had already forgotten it, which is the state
        // we wanted anyway -- only report something that still needs attention.
        const message = err instanceof Error ? err.message : 'unknown error';
        if (!message.includes('not being watched')) {
          setError(`Removed here, but the indexer still has it: ${message}`);
        }
      }
    },
    [reload],
  );

  const isWatched = useCallback(
    (kind: WatchKind, address: string) =>
      items.some((item) => item.kind === kind && item.address === address),
    [items],
  );

  return { items, loading, error, supported, isWatched, watch, unwatch };
}

/**
 * What the *indexer* knows about one watch, as opposed to what this browser
 * does.
 *
 * The two can differ — another browser may have added it, or the mirror to the
 * server may have failed — and anything describing the subscription has to read
 * the server's answer. Polled once per page and shared, rather than fetched
 * again by each component that needs it.
 */
export function useWatchEntry(kind: WatchKind, address: string): WatchEntry | null {
  const registry = usePoll<{ data: WatchEntry[] }>('/api/watchlist', 5_000);

  return (
    registry.data?.data.find((entry) => entry.kind === kind && entry.address === address) ?? null
  );
}
