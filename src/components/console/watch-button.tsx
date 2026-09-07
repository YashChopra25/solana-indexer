'use client';

import { useState } from 'react';
import type { Watchlist } from '@/hooks/use-watchlist';
import type { WatchKind } from '@/lib/api-types';

/**
 * Adds or removes one program or wallet from the watchlist.
 *
 * Two things happen behind this button and they can disagree: the entry is
 * saved in this browser, and the indexer is told to subscribe. The second is
 * the one that can fail, so the button reports it rather than pretending both
 * halves worked.
 */
export function WatchButton({
  kind,
  address,
  watchlist,
}: {
  kind: WatchKind;
  address: string;
  watchlist: Watchlist;
}) {
  const [busy, setBusy] = useState(false);
  const watched = watchlist.isWatched(kind, address);

  if (!watchlist.supported) {
    return (
      <span className="text-[0.625rem] uppercase tracking-[0.16em]" style={{ color: 'var(--dim)' }}>
        watching needs IndexedDB
      </span>
    );
  }

  async function toggle() {
    setBusy(true);
    try {
      if (watched) await watchlist.unwatch(kind, address);
      else await watchlist.watch(kind, address);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy || watchlist.loading}
        aria-pressed={watched}
        className="border px-4 py-1.5 text-[0.625rem] uppercase tracking-[0.18em] transition-colors disabled:opacity-50"
        style={{
          borderColor: watched ? 'var(--signal)' : 'var(--deep)',
          color: watched ? 'var(--signal)' : 'var(--deep)',
        }}
      >
        {busy ? 'saving' : watched ? 'stop watching' : 'watch'}
      </button>

      {watchlist.error && (
        <span className="max-w-sm text-[0.6875rem]" style={{ color: 'var(--signal)' }}>
          {watchlist.error}
        </span>
      )}
    </div>
  );
}
