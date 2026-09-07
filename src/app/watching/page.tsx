'use client';

import Link from 'next/link';
import { FeedState, PageHead, StatusRail, Td, Th } from '@/components/console/shell';
import { usePoll } from '@/hooks/use-poll';
import { useWatchlist } from '@/hooks/use-watchlist';
import { truncate } from '@/lib/format';
import type { WatchEntry, WatchKind } from '@/lib/api-types';

/**
 * The watchlist, from both sides.
 *
 * The rows come from this browser's IndexedDB — the user's own list. The
 * "indexer" column comes from the server's table, which is what the worker
 * actually subscribes to. They are usually the same, and the two cases where
 * they are not are exactly what this page exists to show:
 *
 *  - **not subscribed** — the entry was saved locally but the POST to the
 *    indexer failed, so the stream does not have it.
 *  - **watched elsewhere** — another browser asked for it. The worker is
 *    subscribed, but it is not on this browser's list.
 */
export default function WatchingPage() {
  const watchlist = useWatchlist();
  const registry = usePoll<{ data: WatchEntry[] }>('/api/watchlist', 5_000);

  const onServer = new Set(
    (registry.data?.data ?? []).map((entry) => `${entry.kind}:${entry.address}`),
  );

  const local = new Set(watchlist.items.map((item) => `${item.kind}:${item.address}`));

  // Entries the indexer holds that this browser has never seen.
  const elsewhere = (registry.data?.data ?? []).filter(
    (entry) => !local.has(`${entry.kind}:${entry.address}`),
  );

  const health = watchlist.error || registry.error ? 'stalled' : 'live';

  return (
    <main className="mx-auto w-full max-w-7xl">
      <StatusRail
        health={health}
        detail={`${watchlist.items.length} here · ${onServer.size} on the indexer`}
      />

      <PageHead
        eyebrow="watching"
        value={watchlist.items.length.toLocaleString()}
        note="saved in this browser · mirrored to the indexer's subscription"
      />

      <section className="px-5 pt-4 sm:px-8">
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse text-sm">
            <thead>
              <tr
                className="text-left text-[0.625rem] uppercase tracking-[0.16em]"
                style={{ color: 'var(--dim)' }}
              >
                <Th>Kind</Th>
                <Th>Address</Th>
                <Th>Indexer</Th>
                <Th>Added</Th>
                <Th align="right">{''}</Th>
              </tr>
            </thead>
            <tbody>
              {watchlist.items.map((item) => {
                const subscribed = onServer.has(`${item.kind}:${item.address}`);

                return (
                  <tr
                    key={`${item.kind}:${item.address}`}
                    className="border-b"
                    style={{ borderColor: 'var(--rule)' }}
                  >
                    <Td color="var(--dim)">{item.kind}</Td>
                    <Td title={item.address}>
                      <Link href={pathFor(item.kind, item.address)} style={{ color: 'var(--ink)' }}>
                        {truncate(item.address, 8, 8)}
                      </Link>
                    </Td>
                    <Td color={subscribed ? 'var(--deep)' : 'var(--signal)'}>
                      {subscribed ? 'subscribed' : 'not subscribed'}
                    </Td>
                    <Td color="var(--dim)">{new Date(item.addedAt).toLocaleString()}</Td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => void watchlist.unwatch(item.kind, item.address)}
                        className="text-[0.625rem] uppercase tracking-[0.16em]"
                        style={{ color: 'var(--signal)' }}
                      >
                        remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <FeedState
          error={watchlist.error}
          loading={watchlist.loading}
          empty={watchlist.items.length === 0}
          emptyMessage={
            watchlist.supported
              ? 'Nothing watched yet. Open a program or wallet and press Watch — it is saved in this browser and added to the indexer’s LaserStream subscription within a few seconds.'
              : 'This browser has no IndexedDB, so a watchlist cannot be stored here.'
          }
        />
      </section>

      {elsewhere.length > 0 && (
        <section className="px-5 pb-16 pt-10 sm:px-8">
          <h2 className="font-display text-[0.6875rem] font-600 uppercase tracking-[0.22em]">
            Also on the indexer
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: 'var(--dim)' }}>
            The worker is subscribed to these, but they are not on this browser&apos;s list —
            another browser asked for them. The subscription is shared; the list above is not.
          </p>

          <ul className="mt-4 space-y-1.5 text-sm">
            {elsewhere.map((entry) => (
              <li key={`${entry.kind}:${entry.address}`} className="flex items-baseline gap-3">
                <span style={{ color: 'var(--dim)' }}>{entry.kind}</span>
                <Link
                  href={pathFor(entry.kind, entry.address)}
                  className="tnum"
                  style={{ color: 'var(--ink)' }}
                >
                  {truncate(entry.address, 8, 8)}
                </Link>
                <button
                  type="button"
                  onClick={() => void watchlist.watch(entry.kind, entry.address, entry.label)}
                  className="text-[0.625rem] uppercase tracking-[0.16em]"
                  style={{ color: 'var(--deep)' }}
                >
                  add here
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function pathFor(kind: WatchKind, address: string): string {
  return kind === 'program' ? `/programs/${address}` : `/wallets/${address}`;
}
