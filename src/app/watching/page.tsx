'use client';

import {
  Address,
  Badge,
  FeedState,
  PageHead,
  Row,
  SectionHead,
  StatusRail,
  Table,
  Td,
  Th,
} from '@/components/console/shell';
import { usePoll } from '@/hooks/use-poll';
import { useWatchlist } from '@/hooks/use-watchlist';
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

  const health = watchlist.error || (registry.error && !registry.data) ? 'stalled' : 'live';

  return (
    <>
      <StatusRail
        health={health}
        detail={`${watchlist.items.length} saved here · ${onServer.size} followed by the indexer`}
      />

      <main className="mx-auto w-full max-w-7xl">
        <PageHead
          eyebrow="Your watchlist"
          value={watchlist.items.length.toLocaleString()}
          explain="Wallets and apps you asked the indexer to follow live. The list is saved in this browser; the indexer follows everything on it and records each change as it happens."
        />

        <section className="px-4 sm:px-8">
          {watchlist.items.length > 0 && (
            <Table
              minWidth="42rem"
              head={
                <>
                  <Th>Type</Th>
                  <Th>Address</Th>
                  <Th>Live status</Th>
                  <Th>Added</Th>
                  <Th />
                </>
              }
            >
              {watchlist.items.map((item) => {
                const subscribed = onServer.has(`${item.kind}:${item.address}`);

                return (
                  <Row key={`${item.kind}:${item.address}`}>
                    <Td color="var(--dim)">{item.kind === 'program' ? 'App' : 'Wallet'}</Td>
                    <Td>
                      <Address value={item.address} href={pathFor(item.kind, item.address)} lead={8} tail={8} />
                    </Td>
                    <Td>
                      <Badge tone={subscribed ? 'var(--deep)' : 'var(--signal)'}>
                        {subscribed ? '● Following' : '○ Not connected'}
                      </Badge>
                    </Td>
                    <Td color="var(--dim)">{new Date(item.addedAt).toLocaleString()}</Td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void watchlist.unwatch(item.kind, item.address)}
                        className="text-xs hover:underline"
                        style={{ color: 'var(--signal)' }}
                      >
                        Remove
                      </button>
                    </td>
                  </Row>
                );
              })}
            </Table>
          )}

          <FeedState
            error={watchlist.error}
            loading={watchlist.loading}
            empty={watchlist.items.length === 0}
            emptyMessage={
              watchlist.supported
                ? 'Nothing watched yet. Open any wallet or app and press Watch. It is saved in this browser, and the indexer starts following it within a few seconds.'
                : 'This browser cannot store a watchlist (it has no IndexedDB).'
            }
          />
        </section>

        {elsewhere.length > 0 && (
          <section className="px-4 pb-20 pt-12 sm:px-8">
            <SectionHead
              title="Also followed by the indexer"
              hint="Another browser asked the indexer to follow these. The indexer's list is shared; the list above is only yours."
            />

            <ul className="panel mt-4 divide-y text-sm" style={{ borderColor: 'var(--rule)' }}>
              {elsewhere.map((entry) => (
                <li
                  key={`${entry.kind}:${entry.address}`}
                  className="flex flex-wrap items-center gap-4 px-4 py-3"
                  style={{ borderColor: 'var(--rule)' }}
                >
                  <span className="w-14" style={{ color: 'var(--dim)' }}>
                    {entry.kind === 'program' ? 'App' : 'Wallet'}
                  </span>
                  <Address value={entry.address} href={pathFor(entry.kind, entry.address)} lead={8} tail={8} />
                  <button
                    type="button"
                    onClick={() => void watchlist.watch(entry.kind, entry.address, entry.label)}
                    className="ml-auto text-xs hover:underline"
                    style={{ color: 'var(--deep)' }}
                  >
                    + Add to my list
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

function pathFor(kind: WatchKind, address: string): string {
  return kind === 'program' ? `/programs/${address}` : `/wallets/${address}`;
}
