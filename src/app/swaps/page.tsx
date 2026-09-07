'use client';

import { PageHead, StatusRail } from '@/components/console/shell';
import { SwapFeed } from '@/components/console/feeds';
import { usePoll } from '@/hooks/use-poll';
import { classifyHealth, formatCount } from '@/lib/format';
import type { IndexerStatus, Paginated, Swap } from '@/lib/api-types';

/**
 * Swaps, as inferred from balance movement rather than decoded from any DEX.
 * The page says so, because the difference decides how to read the rows: a
 * multi-hop route shows as what went in and what came out, not as its legs.
 */
export default function SwapsPage() {
  const status = usePoll<IndexerStatus>('/api/status', 5_000);
  const swaps = usePoll<Paginated<Swap>>('/api/swaps?limit=30', 3_000);

  const indexer = status.data?.indexer;
  const health = classifyHealth(indexer?.lagSeconds ?? null, indexer?.slotsProcessed ?? 0);

  return (
    <main className="mx-auto w-full max-w-7xl">
      <StatusRail
        health={health}
        detail={`${formatCount(status.data?.totals.swaps)} swaps indexed`}
      />

      <PageHead
        eyebrow="swaps detected"
        value={formatCount(status.data?.totals.swaps)}
        note="inferred from balance movement · every venue, no per-dex decoders"
      />

      <section className="px-5 pb-16 sm:px-8">
        <SwapFeed
          swaps={swaps.data?.data ?? []}
          loading={swaps.loading}
          error={swaps.error}
        />
      </section>
    </main>
  );
}
