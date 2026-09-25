'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { Address, CounterRail, PageHead, SectionHead, StatusRail } from '@/components/console/shell';
import { ActivityFeed } from '@/components/console/feeds';
import { WatchButton } from '@/components/console/watch-button';
import { AccountFeed } from '@/components/console/account-feed';
import { WatchStatus } from '@/components/console/watch-status';
import { usePoll } from '@/hooks/use-poll';
import { useWatchEntry, useWatchlist } from '@/hooks/use-watchlist';
import { truncate } from '@/lib/format';
import type { AccountUpdate, Activity, ActivityKind, WalletPage } from '@/lib/api-types';

/**
 * One wallet's page: its merged timeline, and a button to put it on the
 * LaserStream subscription.
 *
 * The filter narrows what is shown rather than what is fetched again from
 * scratch — the endpoint takes the same `kind` list, so the counts below always
 * describe the rows on screen.
 */

const FILTERS: { label: string; kinds: ActivityKind[] | null }[] = [
  { label: 'Everything', kinds: null },
  { label: 'Payments', kinds: ['transfer'] },
  { label: 'Trades', kinds: ['swap'] },
  { label: 'App events', kinds: ['event'] },
];

export default function WalletPageView({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);

  const [filter, setFilter] = useState(0);
  const kinds = FILTERS[filter].kinds;

  const query = kinds ? `?limit=50&kind=${kinds.join(',')}` : '?limit=50';
  const activity = usePoll<WalletPage<Activity>>(`/api/wallets/${address}/activity${query}`, 4_000);
  const accounts = usePoll<WalletPage<AccountUpdate>>(`/api/accounts/${address}?limit=25`, 4_000);
  const watchlist = useWatchlist();
  // The indexer's own view of this watch, which is what the status and the
  // account feed describe -- not this browser's list.
  const watchEntry = useWatchEntry('wallet', address);

  const rows = activity.data?.data ?? [];
  // A dropped request with rows still on screen is a hiccup, not an outage.
  const health = activity.data ? 'live' : activity.error ? 'stalled' : 'idle';

  const count = (kind: ActivityKind) => rows.filter((row) => row.kind === kind).length;

  return (
    <>
      <StatusRail health={health} detail={`${rows.length} recent records`} />

      <main className="mx-auto w-full max-w-7xl">
        <PageHead
          eyebrow="Wallet"
          value={truncate(address, 6, 6)}
          explain="Everything this address has done that the indexer has seen: money in and out, trades, and app activity. Press Watch to follow it live — the indexer will then record every change to it."
        >
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs" style={{ color: 'var(--dim)' }}>
            <Address value={address} lead={12} tail={12} />
            <Link href={`/programs/${address}`} className="underline-offset-4 hover:underline">
              Is this an app? View as program →
            </Link>
          </div>

          <div className="mt-5">
            <WatchButton kind="wallet" address={address} watchlist={watchlist} />
            <WatchStatus entry={watchEntry} />
          </div>
        </PageHead>

        <CounterRail
          counters={[
            { label: 'Shown', value: rows.length },
            { label: 'Payments', value: count('transfer') },
            { label: 'Trades', value: count('swap') },
            { label: 'App events', value: count('event') },
            { label: 'Balance changes', value: accounts.data?.data.length ?? 0 },
          ]}
        />

        <section className="px-4 pt-10 sm:px-8">
          <SectionHead title="Activity" hint="Newest first. Green came in, red went out.">
            <div
              className="flex flex-wrap gap-1 rounded-full border p-1 text-sm"
              style={{ borderColor: 'var(--rule-strong)' }}
            >
              {FILTERS.map((option, index) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setFilter(index)}
                  aria-pressed={filter === index}
                  className="rounded-full px-3 py-1 transition-colors"
                  style={{
                    color: filter === index ? 'var(--ink)' : 'var(--dim)',
                    background:
                      filter === index
                        ? 'color-mix(in oklab, var(--violet) 22%, transparent)'
                        : 'transparent',
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </SectionHead>

          <ActivityFeed
            activity={rows}
            loading={activity.loading}
            error={activity.error}
            emptyMessage={`Nothing recorded for ${truncate(address, 6, 6)} yet. Press Watch above and new activity will appear here within a few seconds.`}
          />
        </section>

        <section className="px-4 pb-20 pt-12 sm:px-8">
          <SectionHead
            title="Balance changes"
            hint="Every time this account's SOL balance or stored data changed. Only recorded while the address is being watched."
          />

          <AccountFeed
            updates={accounts.data?.data ?? []}
            loading={accounts.loading}
            error={accounts.error}
            kind="wallet"
            watched={watchEntry !== null}
          />
        </section>
      </main>
    </>
  );
}
