'use client';

import { use } from 'react';
import Link from 'next/link';
import {
  Address,
  Badge,
  CounterRail,
  FeedState,
  PageHead,
  Row,
  SectionHead,
  StatusRail,
  Table,
  Td,
  Th,
} from '@/components/console/shell';
import { WatchButton } from '@/components/console/watch-button';
import { AccountFeed } from '@/components/console/account-feed';
import { WatchStatus } from '@/components/console/watch-status';
import { usePoll } from '@/hooks/use-poll';
import { useWatchEntry, useWatchlist } from '@/hooks/use-watchlist';
import { formatCount, programName, truncate } from '@/lib/format';
import type { ProgramDetail } from '@/lib/api-types';
import { isAddress } from '@/lib/address';
import { InvalidAddress } from '@/components/console/invalid-address';

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

  if (!isAddress(programId)) return <InvalidAddress what="app" value={decodeURIComponent(programId)} />;
  return <Program programId={programId} />;
}

function Program({ programId }: { programId: string }) {
  const detail = usePoll<ProgramDetail>(`/api/programs/${programId}?limit=25`, 5_000);
  const watchlist = useWatchlist();
  // The indexer's own view of this watch, which is what the status and the
  // account feed describe -- not this browser's list.
  const watchEntry = useWatchEntry('program', programId);

  const program = detail.data;
  // Never seen is a normal answer for a new or quiet app, not an outage: say
  // it once, at the top, instead of as an error in every section.
  const unseen = !program && detail.status === 404;
  const error = unseen ? null : detail.error;
  // A dropped request with data still on screen is a hiccup, not an outage.
  const health = unseen ? 'idle' : detail.error ? 'stalled' : program ? 'live' : 'idle';

  const eventTypes = program?.eventTypes ?? [];
  const invocations = program?.invocations ?? [];

  return (
    <>
      <StatusRail
        health={health}
        detail={
          program
            ? `${formatCount(program.invocationCount)} times used`
            : unseen
              ? 'not seen yet'
              : 'reading'
        }
      />

      <main id="main" className="mx-auto w-full max-w-7xl">
        <PageHead
          eyebrow="App (program)"
          value={program ? programName(program.program) : truncate(programId, 6, 6)}
          explain={
            unseen
              ? 'The indexer has not seen this app do anything yet. If it is new or rarely used, press Watch and its activity will appear here as soon as it happens.'
              : 'A program is code that lives on Solana — an exchange, a game, a token. Every time a transaction uses it, that is one “use” below. Press Watch to follow it live.'
          }
        >
          <div className="mt-5 text-xs" style={{ color: 'var(--dim)' }}>
            <Address value={programId} lead={12} tail={12} />
          </div>

          <div className="mt-5">
            <WatchButton kind="program" address={programId} watchlist={watchlist} />
            <WatchStatus entry={watchEntry} />
          </div>
        </PageHead>

        <CounterRail
          counters={[
            { label: 'Times used', value: program?.invocationCount ?? 0 },
            { label: 'Events logged', value: program?.eventCount ?? 0 },
            { label: 'Event kinds', value: eventTypes.length },
            { label: 'Trades routed', value: program?.swapCount ?? 0 },
            { label: 'Data changes', value: program?.accountUpdates.length ?? 0 },
          ]}
        />

        <section className="px-4 pt-10 sm:px-8">
          <SectionHead
            title="Recent uses"
            hint="Each row is one transaction that called this app. Click one to open it."
          />

          {invocations.length > 0 && (
            <Table
              minWidth="44rem"
              head={
                <>
                  <Th>Block</Th>
                  <Th>Transaction</Th>
                  <Th>Result</Th>
                  <Th align="right">Compute used</Th>
                  <Th align="right">Called from depth</Th>
                </>
              }
            >
              {invocations.map((invocation) => (
                <Row key={`${invocation.signature}-${invocation.invocationIndex}`}>
                  <Td color="var(--dim)">#{invocation.slot.toLocaleString()}</Td>
                  <Td title={invocation.signature}>
                    <Link href={`/?q=${invocation.signature}`} className="hover:underline">
                      {truncate(invocation.signature, 8, 8)}
                    </Link>
                  </Td>
                  <Td>
                    <Badge tone={invocation.success ? 'var(--deep)' : 'var(--signal)'}>
                      {invocation.success ? '✓ ok' : '✕ failed'}
                    </Badge>
                  </Td>
                  <Td align="right" color="var(--dim)">
                    {invocation.computeUnits?.toLocaleString() ?? '—'}
                  </Td>
                  <Td align="right" color="var(--dim)">
                    {invocation.depth}
                  </Td>
                </Row>
              ))}
            </Table>
          )}

          <FeedState
            error={error}
            loading={detail.loading}
            empty={invocations.length === 0}
            emptyMessage="Nothing recorded for this app yet. Press Watch above and its activity will start appearing within a few seconds."
          />
        </section>

        <section className="px-4 pt-12 sm:px-8">
          <SectionHead
            title="Event kinds"
            hint="The different messages this app logs, by code. Naming them would need the app's own schema."
          />

          {eventTypes.length > 0 && (
            <Table
              minWidth="36rem"
              head={
                <>
                  <Th>Event code</Th>
                  <Th>Emitted via</Th>
                  <Th align="right">Count</Th>
                  <Th align="right">Last seen in block</Th>
                </>
              }
            >
              {eventTypes.map((type) => (
                <Row key={`${type.discriminator}-${type.source}`}>
                  <Td color="var(--violet)">{type.discriminator}</Td>
                  <Td color="var(--dim)">{type.source === 'cpi' ? 'self-CPI' : 'log'}</Td>
                  <Td align="right">{type.count.toLocaleString()}</Td>
                  <Td align="right" color="var(--dim)">
                    {type.lastSlot ? `#${type.lastSlot.toLocaleString()}` : '—'}
                  </Td>
                </Row>
              ))}
            </Table>
          )}

          <FeedState
            error={error}
            loading={detail.loading}
            empty={eventTypes.length === 0}
            emptyMessage="This app logs no events, or none have been seen yet. Its uses above are recorded either way."
          />
        </section>

        <section className="px-4 pb-20 pt-12 sm:px-8">
          <SectionHead
            title="Data changes"
            hint="Changes to accounts this app stores data in. Only recorded while the app is being watched."
          />

          <AccountFeed
            updates={program?.accountUpdates ?? []}
            loading={detail.loading}
            error={error}
            kind="program"
            watched={watchEntry !== null}
          />
        </section>
      </main>
    </>
  );
}
