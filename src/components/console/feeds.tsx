'use client';

import Link from 'next/link';
import {
  ASSET_LABEL_CH,
  assetLabel,
  formatAmount,
  programName,
  timeAgo,
} from '@/lib/format';
import type { Activity, Amount, ProgramEvent, Swap, Transfer } from '@/lib/api-types';
import { Address, Badge, FeedState, Row, Table, Td, Th, When } from './shell';

/**
 * The four feeds, one per thing this indexer tracks. Each is a table, because
 * these are ledgers and a ledger is scanned down a column — but the columns are
 * named for what a person wants to know (when, who, how much) rather than for
 * the chain's own fields.
 */

/**
 * An asset label in a slot of fixed width.
 *
 * The width is the one a shortened mint already takes, which is what most rows
 * show — so naming the few tokens that have names widens nothing. Without the
 * fixed slot, a feed that repaints every two seconds would nudge its columns
 * sideways each time a row carrying "USDC" replaced one carrying a bare mint.
 *
 * The mint stays on `title`: the symbol is a convenience, the address is the
 * identity, and anything acting on a row needs the address.
 */
function Asset({ mint, symbol }: { mint: string; symbol: string | null }) {
  return (
    <span
      className="inline-block overflow-hidden align-bottom text-ellipsis whitespace-nowrap"
      style={{ width: `${ASSET_LABEL_CH}ch`, color: 'var(--dim)' }}
      title={mint}
    >
      {assetLabel(mint, symbol)}
    </span>
  );
}

/** An amount next to the asset it is denominated in. */
function Value({ value }: { value: Amount | null }) {
  if (!value) return <>—</>;

  return (
    <>
      {formatAmount(value.amount, value.decimals)} <Asset mint={value.mint} symbol={value.symbol} />
    </>
  );
}

const wallet = (address: string) => `/wallets/${address}`;
const program = (id: string) => `/programs/${id}`;

/* ------------------------------------------------------------------ */

export function TransferFeed({
  transfers,
  loading,
  error,
}: {
  transfers: Transfer[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <>
      {transfers.length > 0 && (
        <Table
          minWidth="46rem"
          head={
            <>
              <Th>When</Th>
              <Th>From</Th>
              <Th>{''}</Th>
              <Th>To</Th>
              <Th align="right">Amount</Th>
            </>
          }
        >
          {transfers.map((transfer) => {
            // The owner is who a person recognises; the token account is the
            // fallback when no balance snapshot named one.
            const from = transfer.sourceOwner ?? transfer.source;
            const to = transfer.destinationOwner ?? transfer.destination;

            return (
              <Row key={`${transfer.signature}-${transfer.instructionIndex}-${transfer.innerIndex ?? 'top'}`}>
                <Td>
                  <When ago={timeAgo(transfer.blockTime)} slot={transfer.slot} />
                </Td>
                <Td>
                  <Address value={from} href={wallet(from)} lead={5} tail={5} />
                </Td>
                <Td color="var(--dim)">→</Td>
                <Td>
                  <Address value={to} href={wallet(to)} lead={5} tail={5} />
                </Td>
                <Td align="right" color="var(--deep)">
                  {formatAmount(transfer.amount, transfer.decimals)}{' '}
                  <Asset mint={transfer.mint} symbol={transfer.symbol} />
                </Td>
              </Row>
            );
          })}
        </Table>
      )}

      <FeedState
        error={error}
        loading={loading}
        empty={transfers.length === 0}
        emptyMessage="No payments recorded yet. Start the indexer with `npm run indexer` and they will stream in here."
      />
    </>
  );
}

export function SwapFeed({
  swaps,
  loading,
  error,
}: {
  swaps: Swap[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <>
      {swaps.length > 0 && (
        <Table
          minWidth="52rem"
          head={
            <>
              <Th>When</Th>
              <Th>Trader</Th>
              <Th align="right">Gave</Th>
              <Th align="right">Got</Th>
              <Th>Exchange</Th>
            </>
          }
        >
          {swaps.map((swap) => (
            <Row key={`${swap.signature}-${swap.owner}`}>
              <Td>
                <When ago={timeAgo(swap.blockTime)} slot={swap.slot} />
              </Td>
              <Td>
                <Address value={swap.owner} href={wallet(swap.owner)} lead={5} tail={5} />
              </Td>
              <Td align="right" color="var(--signal)">
                −<Value value={swap.in} />
              </Td>
              <Td align="right" color="var(--deep)">
                +<Value value={swap.out} />
              </Td>
              <Td title={swap.route.map((p) => p.id).join(' → ')}>
                <Badge tone="var(--cyan)">
                  {programName(swap.program)}
                  {swap.route.length > 1 && ` +${swap.route.length - 1} hops`}
                </Badge>
              </Td>
            </Row>
          ))}
        </Table>
      )}

      <FeedState
        error={error}
        loading={loading}
        empty={swaps.length === 0}
        emptyMessage="No trades yet. A trade shows up when one wallet's balance goes down in one token and up in another inside the same transaction."
      />
    </>
  );
}

export function EventFeed({
  events,
  loading,
  error,
}: {
  events: ProgramEvent[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <>
      {events.length > 0 && (
        <Table
          minWidth="48rem"
          head={
            <>
              <Th>When</Th>
              <Th>App (program)</Th>
              <Th>Event code</Th>
              <Th>Emitted via</Th>
              <Th align="right">Size</Th>
            </>
          }
        >
          {events.map((event) => (
            <Row key={`${event.signature}-${event.eventIndex}`}>
              <Td>
                <When ago={timeAgo(event.blockTime)} slot={event.slot} />
              </Td>
              <Td title={event.program.id}>
                <Link href={program(event.program.id)} className="hover:underline">
                  {programName(event.program)}
                </Link>
              </Td>
              {/* The discriminator *is* the event's identity. Turning it into a
                  name would need the program's IDL, which we do not hold. */}
              <Td color="var(--violet)">{event.discriminator}</Td>
              <Td color="var(--dim)">{event.source === 'cpi' ? 'self-CPI' : 'log'}</Td>
              <Td align="right" color="var(--dim)">
                {byteLength(event.data)} bytes
              </Td>
            </Row>
          ))}
        </Table>
      )}

      <FeedState
        error={error}
        loading={loading}
        empty={events.length === 0}
        emptyMessage="No app events yet. Only apps built with Anchor emit these, and the default tracked programs (System and SPL Token) do not."
      />
    </>
  );
}

/** The merged wallet timeline: the three kinds in one column of rows. */
export function ActivityFeed({
  activity,
  loading,
  error,
  emptyMessage,
}: {
  activity: Activity[];
  loading: boolean;
  error: string | null;
  emptyMessage: string;
}) {
  return (
    <>
      {activity.length > 0 && (
        <Table
          minWidth="50rem"
          head={
            <>
              <Th>When</Th>
              <Th>What</Th>
              <Th align="right">Amount</Th>
              <Th>Detail</Th>
              <Th>App</Th>
            </>
          }
        >
          {activity.map((row, index) => (
            <Row key={`${row.signature}-${row.kind}-${index}`}>
              <Td>
                <When ago={timeAgo(row.blockTime)} slot={row.slot} />
              </Td>
              <Td>
                <Badge tone={kindTone(row)}>{kindLabel(row)}</Badge>
              </Td>
              <Td align="right" color={kindTone(row)}>
                {row.kind === 'transfer' && (row.direction === 'out' ? '−' : '+')}
                <Value value={row.primary} />
              </Td>
              <Td color="var(--dim)">
                {row.kind === 'swap' && row.counter && (
                  <>
                    for <Value value={row.counter} />
                  </>
                )}
                {row.kind === 'event' && row.discriminator}
              </Td>
              <Td color="var(--dim)" title={row.program.id}>
                <Link href={program(row.program.id)} className="hover:underline">
                  {programName(row.program)}
                </Link>
              </Td>
            </Row>
          ))}
        </Table>
      )}

      <FeedState
        error={error}
        loading={loading}
        empty={activity.length === 0}
        emptyMessage={emptyMessage}
      />
    </>
  );
}

function kindLabel(row: Activity): string {
  if (row.kind === 'swap') return '⇄ Trade';
  if (row.kind === 'event') return '◆ App event';

  return row.direction === 'out' ? '↑ Sent' : '↓ Received';
}

function kindTone(row: Activity): string {
  if (row.kind === 'event') return 'var(--violet)';
  if (row.kind === 'swap') return 'var(--cyan)';

  return row.direction === 'out' ? 'var(--signal)' : 'var(--deep)';
}

/** Base64 expands 3 bytes into 4 characters, padding included. */
function byteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;

  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}
