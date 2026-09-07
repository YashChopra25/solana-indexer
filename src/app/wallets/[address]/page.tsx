'use client';

import { use, useState } from 'react';
import { CounterRail, PageHead, StatusRail } from '@/components/console/shell';
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
  { label: 'Transfers', kinds: ['transfer'] },
  { label: 'Swaps', kinds: ['swap'] },
  { label: 'Events', kinds: ['event'] },
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
  const health = activity.error ? 'stalled' : activity.data ? 'live' : 'idle';

  const count = (kind: ActivityKind) => rows.filter((row) => row.kind === kind).length;

  return (
    <main className="mx-auto w-full max-w-7xl">
      <StatusRail health={health} detail={`${rows.length} recent records`} />

      <PageHead eyebrow="wallet" value={truncate(address, 6, 6)} note={address} />

      <div className="px-5 pb-6 sm:px-8">
        <WatchButton kind="wallet" address={address} watchlist={watchlist} />
        <WatchStatus entry={watchEntry} />
      </div>

      <CounterRail
        counters={[
          { label: 'Shown', value: rows.length },
          { label: 'Transfers', value: count('transfer') },
          { label: 'Swaps', value: count('swap') },
          { label: 'Events', value: count('event') },
          { label: 'Account writes', value: accounts.data?.data.length ?? 0 },
        ]}
      />

      <section className="px-5 pb-16 pt-8 sm:px-8">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="font-display text-[0.6875rem] font-600 uppercase tracking-[0.22em]">
            Activity
          </h2>

          <div className="flex flex-wrap gap-3 text-[0.625rem] uppercase tracking-[0.16em]">
            {FILTERS.map((option, index) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setFilter(index)}
                aria-pressed={filter === index}
                className="border-b pb-0.5 transition-colors"
                style={{
                  color: filter === index ? 'var(--ink)' : 'var(--dim)',
                  borderColor: filter === index ? 'var(--ink)' : 'transparent',
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <ActivityFeed
          activity={rows}
          loading={activity.loading}
          error={activity.error}
          emptyMessage={`Nothing indexed for ${truncate(address, 6, 6)} yet. Watch it above, and the worker will add it to the stream within a few seconds.`}
        />
      </section>

      <section className="px-5 pb-16 sm:px-8">
        <h2 className="font-display text-[0.6875rem] font-600 uppercase tracking-[0.22em]">
          Account writes
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: 'var(--dim)' }}>
          From the accounts subscription, which the worker opens only for watched
          addresses.
        </p>

        <AccountFeed
          updates={accounts.data?.data ?? []}
          loading={accounts.loading}
          error={accounts.error}
          kind="wallet"
          watched={watchEntry !== null}
        />
      </section>
    </main>
  );
}
