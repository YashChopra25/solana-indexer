'use client';

import Link from 'next/link';
import { FeedState, Row, Table, Td, Th, When } from './shell';
import { formatAmount, programName, timeAgo, truncate } from '@/lib/format';
import type { AccountUpdate } from '@/lib/api-types';

/**
 * Writes to a watched account, from the `accounts` subscription.
 *
 * This is the feed that makes watching visible. Transactions reach the index
 * through a filter whose baseline already matches nearly every transaction on
 * the chain, so adding an address there changes little you can see. An account
 * subscription asks a different question — tell me when *this account* changes,
 * whoever changed it — and only exists for addresses on the watchlist.
 */
export function AccountFeed({
  updates,
  loading,
  error,
  watched,
  kind,
}: {
  updates: AccountUpdate[];
  loading: boolean;
  error: string | null;
  watched: boolean;
  kind: 'program' | 'wallet';
}) {
  return (
    <>
      {updates.length > 0 && (
        <Table
          minWidth="44rem"
          head={
            <>
              <Th>When</Th>
              <Th align="right">SOL balance</Th>
              <Th>Owned by</Th>
              <Th align="right">Data size</Th>
              <Th>Caused by</Th>
            </>
          }
        >
          {updates.map((update) => (
            <Row key={`${update.slot}-${update.writeVersion}`}>
              <Td>
                <When ago={timeAgo(update.observedAt)} slot={update.slot} />
              </Td>
              <Td align="right" color="var(--deep)">
                {formatAmount(update.lamports, 9)} SOL
              </Td>
              <Td color="var(--dim)" title={update.owner.id}>
                {programName(update.owner)}
              </Td>
              <Td align="right" color="var(--dim)">
                {update.dataLength.toLocaleString()} B
              </Td>
              <Td color="var(--dim)" title={update.signature ?? ''}>
                {update.signature ? (
                  <Link href={`/?q=${update.signature}`} className="hover:underline">
                    {truncate(update.signature, 6, 6)}
                  </Link>
                ) : (
                  '—'
                )}
              </Td>
            </Row>
          ))}
        </Table>
      )}

      <FeedState
        error={error}
        loading={loading}
        empty={updates.length === 0}
        emptyMessage={
          watched
            ? kind === 'program'
              ? 'Watching. This lists accounts the app stores data in. Many apps own none — exchanges and routers work with token accounts owned by other programs — so this can stay empty while the watch is working. The match count above is the number to read.'
              : 'Watching. Changes appear here the next time this account changes on-chain.'
            : 'Press Watch above. The indexer then follows this address live and records every change to it here.'
        }
      />
    </>
  );
}
