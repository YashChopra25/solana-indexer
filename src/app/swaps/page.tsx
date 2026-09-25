'use client';

import { PageHead, SectionHead, StatusRail } from '@/components/console/shell';
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
    <>
      <StatusRail
        health={health}
        detail={`${formatCount(status.data?.totals.swaps)} trades found`}
      />

      <main className="mx-auto w-full max-w-7xl">
        <PageHead
          eyebrow="Trades detected"
          value={formatCount(status.data?.totals.swaps)}
          explain="A trade (or “swap”) is when a wallet gives up one token and receives another in the same transaction — for example, selling USDC for SOL on an exchange like Jupiter or Raydium. We spot them by watching balances change, so every exchange is covered without special code for each one."
        />

        <section className="px-4 pb-20 sm:px-8">
          <SectionHead
            title="Latest trades"
            hint="Red is what the trader gave up, green is what they received."
          />
          <SwapFeed
            swaps={swaps.data?.data ?? []}
            loading={swaps.loading}
            error={swaps.error}
          />
        </section>
      </main>
    </>
  );
}
