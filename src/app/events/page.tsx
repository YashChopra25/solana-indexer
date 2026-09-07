'use client';

import { PageHead, StatusRail } from '@/components/console/shell';
import { EventFeed } from '@/components/console/feeds';
import { usePoll } from '@/hooks/use-poll';
import { classifyHealth, formatCount } from '@/lib/format';
import type { IndexerStatus, Paginated, ProgramEvent } from '@/lib/api-types';

/**
 * Anchor events, kept as bytes. The event type column shows discriminators
 * rather than names because naming them needs each program's IDL, and this
 * indexer holds none -- see docs/how-it-works.md.
 */
export default function EventsPage() {
  const status = usePoll<IndexerStatus>('/api/status', 5_000);
  const events = usePoll<Paginated<ProgramEvent>>('/api/events?limit=30', 3_000);

  const indexer = status.data?.indexer;
  const health = classifyHealth(indexer?.lagSeconds ?? null, indexer?.slotsProcessed ?? 0);

  return (
    <main className="mx-auto w-full max-w-7xl">
      <StatusRail
        health={health}
        detail={`${formatCount(status.data?.totals.events)} events indexed`}
      />

      <PageHead
        eyebrow="program events"
        value={formatCount(status.data?.totals.events)}
        note="anchor emit! and emit_cpi! · payloads kept as bytes"
      />

      <section className="px-5 pb-16 sm:px-8">
        <EventFeed
          events={events.data?.data ?? []}
          loading={events.loading}
          error={events.error}
        />
      </section>
    </main>
  );
}
