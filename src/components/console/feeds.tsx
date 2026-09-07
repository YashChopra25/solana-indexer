'use client';

import {
  ASSET_LABEL_CH,
  assetLabel,
  formatAmount,
  programName,
  truncate,
} from '@/lib/format';
import type { Activity, Amount, ProgramEvent, Swap, Transfer } from '@/lib/api-types';
import { FeedState, Td, Th } from './shell';

/**
 * The four feeds, one per thing this indexer tracks. They are deliberately
 * plain tables: these are ledgers, and a ledger's job is to be scanned down a
 * column, not decorated.
 */

function Table({ minWidth, head, children }: {
  minWidth: string;
  head: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        <thead>
          <tr
            className="text-left text-[0.625rem] uppercase tracking-[0.16em]"
            style={{ color: 'var(--dim)' }}
          >
            {head}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <tr className="border-b" style={{ borderColor: 'var(--rule)' }}>
      {children}
    </tr>
  );
}

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
      style={{ width: `${ASSET_LABEL_CH}ch` }}
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
      {formatAmount(value.amount, value.decimals)}{' '}
      <Asset mint={value.mint} symbol={value.symbol} />
    </>
  );
}

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
      <Table
        minWidth="46rem"
        head={
          <>
            <Th>Slot</Th>
            <Th>From</Th>
            <Th>To</Th>
            <Th align="right">Amount</Th>
            <Th>Asset</Th>
          </>
        }
      >
        {transfers.map((transfer) => (
          <Row key={`${transfer.signature}-${transfer.instructionIndex}-${transfer.innerIndex ?? 'top'}`}>
            <Td color="var(--dim)">{transfer.slot.toLocaleString()}</Td>
            {/* The owner is what an operator recognises; the token account is
                the fallback when no balance snapshot named one. */}
            <Td title={transfer.sourceOwner ?? transfer.source}>
              {truncate(transfer.sourceOwner ?? transfer.source, 6, 6)}
            </Td>
            <Td title={transfer.destinationOwner ?? transfer.destination}>
              {truncate(transfer.destinationOwner ?? transfer.destination, 6, 6)}
            </Td>
            <Td align="right" color="var(--deep)">
              {formatAmount(transfer.amount, transfer.decimals)}
            </Td>
            <Td color="var(--dim)">
              <Asset mint={transfer.mint} symbol={transfer.symbol} />
            </Td>
          </Row>
        ))}
      </Table>

      <FeedState
        error={error}
        loading={loading}
        empty={transfers.length === 0}
        emptyMessage="No transfers indexed yet. Start the worker with `npm run indexer`."
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
      <Table
        minWidth="52rem"
        head={
          <>
            <Th>Slot</Th>
            <Th>Owner</Th>
            <Th align="right">Sold</Th>
            <Th align="right">Bought</Th>
            <Th>Venue</Th>
          </>
        }
      >
        {swaps.map((swap) => (
          <Row key={`${swap.signature}-${swap.owner}`}>
            <Td color="var(--dim)">{swap.slot.toLocaleString()}</Td>
            <Td title={swap.owner}>{truncate(swap.owner, 6, 6)}</Td>
            <Td align="right" color="var(--signal)">
              <Value value={swap.in} />
            </Td>
            <Td align="right" color="var(--deep)">
              <Value value={swap.out} />
            </Td>
            <Td color="var(--dim)" title={swap.route.map((p) => p.id).join(' → ')}>
              {programName(swap.program)}
              {swap.route.length > 1 && ` +${swap.route.length - 1}`}
            </Td>
          </Row>
        ))}
      </Table>

      <FeedState
        error={error}
        loading={loading}
        empty={swaps.length === 0}
        emptyMessage="No swaps yet. Swaps are inferred from balance movement, so they appear once a signer's holdings change in two directions at once."
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
      <Table
        minWidth="48rem"
        head={
          <>
            <Th>Slot</Th>
            <Th>Program</Th>
            <Th>Event type</Th>
            <Th>Emitted via</Th>
            <Th align="right">Payload</Th>
          </>
        }
      >
        {events.map((event) => (
          <Row key={`${event.signature}-${event.eventIndex}`}>
            <Td color="var(--dim)">{event.slot.toLocaleString()}</Td>
            <Td title={event.program.id}>{programName(event.program)}</Td>
            {/* The discriminator *is* the event's identity. Turning it into a
                name would need the program's IDL, which we do not hold. */}
            <Td color="var(--deep)">{event.discriminator}</Td>
            <Td color="var(--dim)">{event.source === 'cpi' ? 'self-CPI' : 'log'}</Td>
            <Td align="right" color="var(--dim)">
              {byteLength(event.data)} bytes
            </Td>
          </Row>
        ))}
      </Table>

      <FeedState
        error={error}
        loading={loading}
        empty={events.length === 0}
        emptyMessage="No Anchor events yet. Only programs that emit them produce rows here, and the default tracked programs (System and SPL Token) do not."
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
      <Table
        minWidth="50rem"
        head={
          <>
            <Th>Slot</Th>
            <Th>Kind</Th>
            <Th align="right">Value</Th>
            <Th>Detail</Th>
            <Th>Program</Th>
          </>
        }
      >
        {activity.map((row, index) => (
          <Row key={`${row.signature}-${row.kind}-${index}`}>
            <Td color="var(--dim)">{row.slot.toLocaleString()}</Td>
            <Td color={kindTone(row)}>{kindLabel(row)}</Td>
            <Td align="right" color={kindTone(row)}>
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
              {programName(row.program)}
            </Td>
          </Row>
        ))}
      </Table>

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
  if (row.kind === 'swap') return 'swap';
  if (row.kind === 'event') return 'event';

  return row.direction === 'out' ? 'sent' : 'received';
}

function kindTone(row: Activity): string {
  if (row.kind === 'event') return 'var(--dim)';
  if (row.kind === 'swap') return 'var(--ink)';

  return row.direction === 'out' ? 'var(--signal)' : 'var(--deep)';
}

/** Base64 expands 3 bytes into 4 characters, padding included. */
function byteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;

  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}
