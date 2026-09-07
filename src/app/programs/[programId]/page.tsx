'use client';

import { use } from 'react';
import Link from 'next/link';
import { CounterRail, FeedState, PageHead, StatusRail, Td, Th } from '@/components/console/shell';
import { WatchButton } from '@/components/console/watch-button';
import { AccountFeed } from '@/components/console/account-feed';
import { WatchStatus } from '@/components/console/watch-status';
import { usePoll } from '@/hooks/use-poll';
import { useWatchEntry, useWatchlist } from '@/hooks/use-watchlist';
import { formatCount, programName, truncate } from '@/lib/format';
import type { ProgramDetail } from '@/lib/api-types';

/**
 * One program's page: what it has done, what it emits, and a button to put it
 * on the LaserStream subscription.
 *
 * Everything here is the program's own footprint. Its event payloads are shown
 * by type and size rather than decoded, because decoding needs the program's
 * IDL and the indexer deliberately holds none.
 */
export default function ProgramPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = use(params);

  const detail = usePoll<ProgramDetail>(`/api/programs/${programId}?limit=25`, 5_000);
  const watchlist = useWatchlist();
  // The indexer's own view of this watch, which is what the status and the
  // account feed describe -- not this browser's list.
  const watchEntry = useWatchEntry('program', programId);

  const program = detail.data;
  const health = detail.error ? 'stalled' : program ? 'live' : 'idle';

  return (
    <main className="mx-auto w-full max-w-7xl">
      <StatusRail
        health={health}
        detail={program ? `${formatCount(program.invocationCount)} invocations` : 'reading'}
      />

      <PageHead
        eyebrow="program"
        value={program ? programName(program.program) : truncate(programId, 6, 6)}
        note={programId}
      />

      <div className="px-5 pb-6 sm:px-8">
        <WatchButton kind="program" address={programId} watchlist={watchlist} />
        <WatchStatus entry={watchEntry} />
      </div>

      <CounterRail
        counters={[
          { label: 'Invocations', value: program?.invocationCount ?? 0 },
          { label: 'Events', value: program?.eventCount ?? 0 },
          { label: 'Event types', value: program?.eventTypes.length ?? 0 },
          { label: 'Swaps', value: program?.swapCount ?? 0 },
          { label: 'Account writes', value: program?.accountUpdates.length ?? 0 },
        ]}
      />

      <section className="px-5 pt-8 sm:px-8">
        <h2 className="font-display text-[0.6875rem] font-600 uppercase tracking-[0.22em]">
          Account writes
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: 'var(--dim)' }}>
          From the accounts subscription, which the worker opens only for watched
          addresses.
        </p>

        <AccountFeed
          updates={program?.accountUpdates ?? []}
          loading={detail.loading}
          error={detail.error}
          kind="program"
          watched={watchEntry !== null}
        />
      </section>

      <section className="px-5 pt-8 sm:px-8">
        <h2 className="font-display text-[0.6875rem] font-600 uppercase tracking-[0.22em]">
          Event types
        </h2>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr
                className="text-left text-[0.625rem] uppercase tracking-[0.16em]"
                style={{ color: 'var(--dim)' }}
              >
                <Th>Discriminator</Th>
                <Th>Emitted via</Th>
                <Th align="right">Count</Th>
                <Th align="right">Last slot</Th>
              </tr>
            </thead>
            <tbody>
              {(program?.eventTypes ?? []).map((type) => (
                <tr
                  key={`${type.discriminator}-${type.source}`}
                  className="border-b"
                  style={{ borderColor: 'var(--rule)' }}
                >
                  <Td color="var(--deep)">{type.discriminator}</Td>
                  <Td color="var(--dim)">{type.source === 'cpi' ? 'self-CPI' : 'log'}</Td>
                  <Td align="right">{type.count.toLocaleString()}</Td>
                  <Td align="right" color="var(--dim)">
                    {type.lastSlot?.toLocaleString() ?? '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <FeedState
          error={detail.error}
          loading={detail.loading}
          empty={(program?.eventTypes.length ?? 0) === 0}
          emptyMessage="This program emits no Anchor events, or none have been indexed yet. Its invocations are below either way."
        />
      </section>

      <section className="px-5 pb-16 pt-8 sm:px-8">
        <h2 className="font-display text-[0.6875rem] font-600 uppercase tracking-[0.22em]">
          Recent invocations
        </h2>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <thead>
              <tr
                className="text-left text-[0.625rem] uppercase tracking-[0.16em]"
                style={{ color: 'var(--dim)' }}
              >
                <Th>Slot</Th>
                <Th>Transaction</Th>
                <Th align="right">Depth</Th>
                <Th align="right">Compute</Th>
                <Th>Result</Th>
                <Th align="right">Log lines</Th>
              </tr>
            </thead>
            <tbody>
              {(program?.invocations ?? []).map((invocation) => (
                <tr
                  key={`${invocation.signature}-${invocation.invocationIndex}`}
                  className="border-b"
                  style={{ borderColor: 'var(--rule)' }}
                >
                  <Td color="var(--dim)">{invocation.slot.toLocaleString()}</Td>
                  <Td title={invocation.signature}>
                    <Link href={`/?q=${invocation.signature}`} style={{ color: 'var(--ink)' }}>
                      {truncate(invocation.signature, 6, 6)}
                    </Link>
                  </Td>
                  <Td align="right" color="var(--dim)">
                    {invocation.depth}
                  </Td>
                  <Td align="right" color="var(--dim)">
                    {invocation.computeUnits?.toLocaleString() ?? '—'}
                  </Td>
                  <Td color={invocation.success ? 'var(--deep)' : 'var(--signal)'}>
                    {invocation.success ? 'ok' : 'failed'}
                  </Td>
                  <Td align="right" color="var(--dim)">
                    {invocation.logs.length}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <FeedState
          error={detail.error}
          loading={detail.loading}
          empty={(program?.invocations.length ?? 0) === 0}
          emptyMessage="Nothing indexed for this program yet. Watch it above, and the worker will add it to the stream within a few seconds."
        />
      </section>
    </main>
  );
}
