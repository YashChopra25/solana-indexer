'use client';

import { FeedState, Td, Th } from './shell';
import { formatAmount, programName, truncate } from '@/lib/format';
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
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <thead>
            <tr
              className="text-left text-[0.625rem] uppercase tracking-[0.16em]"
              style={{ color: 'var(--dim)' }}
            >
              <Th>Slot</Th>
              <Th align="right">Lamports</Th>
              <Th>Owner</Th>
              <Th align="right">Data</Th>
              <Th>Caused by</Th>
            </tr>
          </thead>
          <tbody>
            {updates.map((update) => (
              <tr
                key={`${update.slot}-${update.writeVersion}`}
                className="border-b"
                style={{ borderColor: 'var(--rule)' }}
              >
                <Td color="var(--dim)">{update.slot.toLocaleString()}</Td>
                <Td align="right" color="var(--deep)">
                  {formatAmount(update.lamports, 9)}
                </Td>
                <Td color="var(--dim)" title={update.owner.id}>
                  {programName(update.owner)}
                </Td>
                <Td align="right" color="var(--dim)">
                  {update.dataLength.toLocaleString()} B
                </Td>
                <Td color="var(--dim)" title={update.signature ?? ''}>
                  {update.signature ? truncate(update.signature, 6, 6) : '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <FeedState
        error={error}
        loading={loading}
        empty={updates.length === 0}
        emptyMessage={
          watched
            ? kind === 'program'
              ? 'Subscribed by owner — this lists accounts the program writes to. Many programs own none: routers and aggregators operate on token and system accounts owned by those programs instead, so this stays empty while the watch is still working. The match count above is the one to read.'
              : 'Subscribed — writes appear here the next time this account changes on chain.'
            : 'Press Watch above. The worker then opens an accounts subscription for this address and records every write to it here.'
        }
      />
    </>
  );
}
