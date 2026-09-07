'use client';

import { CounterRail, PageHead, StatusRail } from '@/components/console/shell';
import { TransferFeed } from '@/components/console/feeds';
import { Lookup } from '@/components/console/lookup';
import { usePoll } from '@/hooks/use-poll';
import { classifyHealth, formatCount, formatLag } from '@/lib/format';
import type { IndexerStatus, Paginated, Transfer } from '@/lib/api-types';

/**
 * The index at a glance: how far behind it is, what it holds, and the token
 * transfers arriving now. The lookup field turns it into a wallet explorer.
 */
export default function ActivityPage() {
  const status = usePoll<IndexerStatus>('/api/status', 2_000);
  const transfers = usePoll<Paginated<Transfer>>('/api/transfers?limit=20', 3_000);

  const indexer = status.data?.indexer;
  const totals = status.data?.totals;
  const health = classifyHealth(indexer?.lagSeconds ?? null, indexer?.slotsProcessed ?? 0);

  const behind = Math.max(
    0,
    (indexer?.estimatedTipSlot ?? 0) - (indexer?.lastProcessedSlot ?? 0),
  );

  return (
    <main className="mx-auto w-full max-w-7xl">
      <StatusRail
        health={health}
        detail={
          status.error ? 'api unreachable' : `${formatCount(indexer?.slotsProcessed)} slots indexed`
        }
      />

      <PageHead
        eyebrow="behind the chain by"
        value={indexer?.lastProcessedSlot ? formatLag(indexer.lagSeconds) : '—'}
        note={
          indexer?.lastProcessedSlot
            ? `checkpoint ${indexer.lastProcessedSlot.toLocaleString()} · ≈ ${behind.toLocaleString()} slots`
            : 'no data yet'
        }
        tone={health === 'live' ? 'var(--ink)' : health === 'idle' ? 'var(--dim)' : 'var(--signal)'}
      />

      <CounterRail
        counters={[
          { label: 'Transactions', value: totals?.transactions ?? 0 },
          { label: 'Transfers', value: totals?.transfers ?? 0 },
          { label: 'Swaps', value: totals?.swaps ?? 0 },
          { label: 'Events', value: totals?.events ?? 0 },
          { label: 'Accounts', value: totals?.accounts ?? 0 },
          { label: 'Tokens', value: totals?.tokens ?? 0 },
        ]}
      />

      <Lookup />

      <section className="px-5 pb-16 pt-8 sm:px-8">
        <h2 className="font-display text-[0.6875rem] font-600 uppercase tracking-[0.22em]">
          Latest transfers
        </h2>

        <TransferFeed
          transfers={transfers.data?.data ?? []}
          loading={transfers.loading}
          error={status.error ?? transfers.error}
        />
      </section>
    </main>
  );
}
