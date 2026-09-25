'use client';

import { PageHead, SectionHead, StatusRail } from '@/components/console/shell';
import { EventFeed } from '@/components/console/feeds';
import { usePoll } from '@/hooks/use-poll';
import { classifyHealth, formatCount } from '@/lib/format';
import type { IndexerStatus, Paginated, ProgramEvent } from '@/lib/api-types';

/**
 * Anchor events, kept as bytes. The event code column shows discriminators
 * rather than names because naming them needs each program's IDL, and this
 * indexer holds none -- see docs/how-it-works.md.
 */
export default function EventsPage() {
  const status = usePoll<IndexerStatus>('/api/status', 5_000);
  const events = usePoll<Paginated<ProgramEvent>>('/api/events?limit=30', 3_000);

  const indexer = status.data?.indexer;
  const health = classifyHealth(indexer?.lagSeconds ?? null, indexer?.slotsProcessed ?? 0);

  return (
    <>
      <StatusRail
        health={health}
        detail={`${formatCount(status.data?.totals.events)} events recorded`}
      />

      <main className="mx-auto w-full max-w-7xl">
        <PageHead
          eyebrow="App events"
          value={formatCount(status.data?.totals.events)}
          explain="Apps on Solana can leave short messages on-chain when something happens — “order filled”, “reward claimed”. Each kind of message has a code. We record every one we see; reading what is inside needs the app's own schema, so here you see the code and its size."
        />

        <section className="px-4 pb-20 sm:px-8">
          <SectionHead title="Latest events" hint="Click an app to see everything it has done." />
          <EventFeed
            events={events.data?.data ?? []}
            loading={events.loading}
            error={events.error}
          />
        </section>
      </main>
    </>
  );
}
