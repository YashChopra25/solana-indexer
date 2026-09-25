'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import bs58 from 'bs58';
import { usePoll } from '@/hooks/use-poll';
import { formatAmount, formatValue, programName, timeAgo } from '@/lib/format';
import type { TransactionDetail } from '@/lib/api-types';
import { Address, Badge } from './shell';

/**
 * One field for the two things a person has in hand: an address or a
 * transaction signature. Their lengths tell them apart, so there is no mode to
 * pick first.
 *
 * An address opens its own page, where it can be watched. A signature has no
 * page of its own — it is one record, not a subject — so it expands here. It
 * also reads `?q=`, which is how other pages link to a transaction.
 */

type Target =
  | { kind: 'address'; address: string }
  | { kind: 'transaction'; signature: string };

/** A signature decodes to 64 bytes, an address to 32. Nothing else is valid. */
function classify(input: string): Target | null {
  try {
    const length = bs58.decode(input).length;
    if (length === 64) return { kind: 'transaction', signature: input };
    if (length === 32) return { kind: 'address', address: input };
  } catch {
    return null;
  }

  return null;
}

/** Well-known addresses, so a newcomer has something to click. */
const EXAMPLES = [
  { label: 'Jupiter (trading app)', address: 'JUP6LkbZbjS1jKKwapdHNC3AdS1Km9ZtqpSgHoDVFW7' },
  { label: 'Token program', address: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
];

export function Lookup() {
  const router = useRouter();
  const initial = useSearchParams().get('q') ?? '';
  const initialTarget = classify(initial);

  const [query, setQuery] = useState(initial);
  const [target, setTarget] = useState<Target | null>(
    initialTarget?.kind === 'transaction' ? initialTarget : null,
  );
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();

    const found = classify(query.trim());

    if (!found) {
      setTarget(null);
      setError(
        'That does not look like a Solana address or transaction ID. Paste one from a wallet app or an explorer — it is a long string of letters and numbers.',
      );
      return;
    }

    setError(null);

    // An address could be a wallet or a program and the two are the same 32
    // bytes, so the wallet page is the default -- it links on to the program
    // page, which is the rarer thing to be looking for.
    if (found.kind === 'address') {
      router.push(`/wallets/${found.address}`);
      return;
    }

    setTarget(found);
  }

  return (
    <section className="px-4 pt-8 sm:px-8">
      <form onSubmit={onSubmit} className="grad-edge flex items-center gap-2 rounded-2xl p-1.5 pl-4">
        <span aria-hidden style={{ color: 'var(--dim)' }}>
          ⌕
        </span>
        <label htmlFor="lookup" className="sr-only">
          Search a wallet, app or transaction
        </label>
        <input
          id="lookup"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Paste a wallet address, app address or transaction ID"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-[var(--dim)]"
        />
        <button
          type="submit"
          className="font-display shrink-0 rounded-xl px-5 py-2.5 text-sm font-600 transition-transform hover:scale-[1.03] active:scale-[0.98]"
          style={{ background: 'var(--gradient)', color: '#06060c' }}
        >
          Search
        </button>
      </form>

      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--dim)' }}>
        Try:
        {EXAMPLES.map((example) => (
          <button
            key={example.address}
            type="button"
            onClick={() => router.push(`/programs/${example.address}`)}
            className="rounded-full border px-2.5 py-0.5 transition-colors hover:border-[var(--violet)]"
            style={{ borderColor: 'var(--rule-strong)' }}
          >
            {example.label}
          </button>
        ))}
      </p>

      {error && (
        <p className="mt-4 text-sm" style={{ color: 'var(--signal)' }}>
          {error}
        </p>
      )}

      {target?.kind === 'transaction' && (
        <TransactionResult key={target.signature} signature={target.signature} />
      )}
    </section>
  );
}

function TransactionResult({ signature }: { signature: string }) {
  const detail = usePoll<TransactionDetail>(`/api/transactions/${signature}`, 10_000);
  const tx = detail.data;

  if (!tx) {
    return (
      <div className="panel mt-4 px-5 py-5 text-sm" style={{ color: detail.error ? 'var(--signal)' : 'var(--dim)' }}>
        {detail.error ?? 'Reading the chain…'}
      </div>
    );
  }

  return (
    <div className="panel mt-4 px-5 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={tx.success ? 'var(--deep)' : 'var(--signal)'}>
          {tx.success ? '✓ Succeeded' : '✕ Failed'}
        </Badge>
        <Address value={tx.signature} lead={10} tail={10} />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Field label="When">
          {timeAgo(tx.blockTime)} · block #{tx.slot.toLocaleString()}
        </Field>
        <Field label="Network fee">{formatAmount(tx.fee, 9)} SOL</Field>
        <Field label="Paid by">
          {tx.feePayer ? <Address value={tx.feePayer} href={`/wallets/${tx.feePayer}`} /> : '—'}
        </Field>
        <Field label="Apps involved">{tx.programs.map(programName).join(', ') || '—'}</Field>
      </dl>

      <Section title="Payments" count={tx.transfers.length}>
        {tx.transfers.map((transfer, index) => (
          <li key={index} className="flex flex-wrap items-baseline gap-x-2">
            <Address value={transfer.sourceOwner ?? transfer.source} />
            <span style={{ color: 'var(--dim)' }}>sent</span>
            <span className="tnum" style={{ color: 'var(--deep)' }}>
              {formatValue({
                mint: transfer.mint,
                amount: transfer.amount,
                decimals: transfer.decimals,
                symbol: transfer.symbol,
              })}
            </span>
            <span style={{ color: 'var(--dim)' }}>to</span>
            <Address value={transfer.destinationOwner ?? transfer.destination} />
          </li>
        ))}
      </Section>

      <Section title="Trades" count={tx.swaps.length}>
        {tx.swaps.map((swap, index) => (
          <li key={index} className="flex flex-wrap items-baseline gap-x-2">
            <Address value={swap.owner} />
            <span style={{ color: 'var(--dim)' }}>traded</span>
            <span className="tnum" style={{ color: 'var(--signal)' }}>
              {formatValue(swap.in)}
            </span>
            <span style={{ color: 'var(--dim)' }}>for</span>
            <span className="tnum" style={{ color: 'var(--deep)' }}>
              {formatValue(swap.out)}
            </span>
            <span style={{ color: 'var(--dim)' }}>on {programName(swap.program)}</span>
          </li>
        ))}
      </Section>

      <Section title="App events" count={tx.events.length}>
        {tx.events.map((event, index) => (
          <li key={index} className="flex flex-wrap items-baseline gap-x-2">
            <span style={{ color: 'var(--dim)' }}>{programName(event.program)}</span>
            <span className="tnum" style={{ color: 'var(--violet)' }}>
              {event.discriminator}
            </span>
          </li>
        ))}
      </Section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs" style={{ color: 'var(--dim)' }}>
        {label}
      </dt>
      <dd className="tnum mt-1 truncate text-sm">{children}</dd>
    </div>
  );
}

/** A titled list that hides itself when the transaction produced none. */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;

  return (
    <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--rule)' }}>
      <p className="text-xs" style={{ color: 'var(--dim)' }}>
        {title} · {count}
      </p>
      <ul className="mt-2 space-y-1.5 text-sm">{children}</ul>
    </div>
  );
}
