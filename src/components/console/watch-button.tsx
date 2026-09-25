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
      <span className="text-xs" style={{ color: 'var(--dim)' }}>
        This browser cannot save a watchlist (no IndexedDB).
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
        className={`font-display rounded-xl px-5 py-2 text-sm font-600 transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:opacity-50 ${watched ? 'border' : ''}`}
        style={
          watched
            ? { borderColor: 'var(--signal)', color: 'var(--signal)' }
            : { background: 'var(--gradient)', color: '#06060c' }
        }
      >
        {busy ? 'Saving…' : watched ? 'Stop watching' : '★ Watch'}
      </button>

      {watchlist.error && (
        <span className="max-w-sm text-xs" style={{ color: 'var(--signal)' }}>
          {watchlist.error}
        </span>
      )}
    </div>
  );
}
