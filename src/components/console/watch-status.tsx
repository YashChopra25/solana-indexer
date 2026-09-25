'use client';

import type { WatchEntry } from '@/lib/api-types';

/**
 * What this address's watch has actually matched.
 *
 * Watching a program is otherwise invisible, for two reasons that both look
 * like breakage: its transactions already arrive under the broad baseline
 * filter, and its accounts subscription is silent unless the program owns
 * mutable accounts — which routers and aggregators do not. The per-watch filter
 * exists precisely so there is a number to show here.
 */
export function WatchStatus({ entry }: { entry: WatchEntry | null }) {
  if (!entry) return null;

  const matched = entry.matchedCount;

  return (
    <p
      className="mt-3 text-xs"
      style={{ color: matched > 0 ? 'var(--deep)' : 'var(--dim)' }}
    >
      {matched > 0
        ? `● Following live · ${matched.toLocaleString()} updates seen${
            entry.lastMatchedSlot ? ` · latest in block #${entry.lastMatchedSlot.toLocaleString()}` : ''
          }`
        : '● Following live · nothing new since you started watching'}
    </p>
  );
}
