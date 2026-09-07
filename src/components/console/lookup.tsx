'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import bs58 from 'bs58';
import { usePoll } from '@/hooks/use-poll';
import { formatAmount, formatValue, programName, truncate } from '@/lib/format';
import type { TransactionDetail } from '@/lib/api-types';

/**
 * One field for the two things an operator has in hand: a base58 address or a
 * transaction signature. Their lengths tell them apart, so there is no mode to
 * pick first.
 *
 * An address opens its own page, where it can be watched. A signature has no
 * page of its own — it is one record, not a subject — so it expands here.
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

export function Lookup() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();

    const found = classify(query.trim());

    if (!found) {
      setTarget(null);
      setError('Enter a base58 address (32 bytes) or transaction signature (64 bytes).');
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
    <section className="border-b px-5 py-6 sm:px-8" style={{ borderColor: 'var(--rule)' }}>
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="lookup"
          className="text-[0.625rem] uppercase tracking-[0.18em]"
          style={{ color: 'var(--dim)' }}
        >
          Look up
        </label>

        <input
          id="lookup"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Wallet or program address, or a transaction signature"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 border-b bg-transparent py-1.5 text-sm outline-none"
          style={{ borderColor: 'var(--rule-strong)' }}
        />

        <button
          type="submit"
          className="border px-4 py-1.5 text-[0.625rem] uppercase tracking-[0.18em] transition-colors"
          style={{ borderColor: 'var(--deep)', color: 'var(--deep)' }}
        >
          Read
        </button>
      </form>

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

  if (detail.error) {
    return (
      <p className="mt-4 text-sm" style={{ color: 'var(--signal)' }}>
        {detail.error}
      </p>
    );
  }

  if (!tx) {
    return (
      <p className="mt-4 text-sm" style={{ color: 'var(--dim)' }}>
        Reading the index…
      </p>
    );
  }

  return (
    <div className="mt-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Field label="Slot">{tx.slot.toLocaleString()}</Field>
        <Field label="Status">
          <span style={{ color: tx.success ? 'var(--deep)' : 'var(--signal)' }}>
            {tx.success ? 'success' : 'failed'}
          </span>
        </Field>
        <Field label="Fee">{formatAmount(tx.fee, 9)} SOL</Field>
        <Field label="Programs">{tx.programs.length}</Field>
      </dl>

      <Section title="Transfers" count={tx.transfers.length}>
        {tx.transfers.map((transfer, index) => (
          <li key={index} className="flex flex-wrap items-baseline gap-x-2">
            <span style={{ color: 'var(--dim)' }}>
              {truncate(transfer.sourceOwner ?? transfer.source, 4, 4)} →{' '}
              {truncate(transfer.destinationOwner ?? transfer.destination, 4, 4)}
            </span>
            <span className="tnum" style={{ color: 'var(--deep)' }}>
              {formatValue({
                mint: transfer.mint,
                amount: transfer.amount,
                decimals: transfer.decimals,
                symbol: transfer.symbol,
              })}
            </span>
          </li>
        ))}
      </Section>

      <Section title="Swaps" count={tx.swaps.length}>
        {tx.swaps.map((swap, index) => (
          <li key={index} className="flex flex-wrap items-baseline gap-x-2">
            <span style={{ color: 'var(--dim)' }}>{truncate(swap.owner, 4, 4)}</span>
            <span className="tnum" style={{ color: 'var(--signal)' }}>
              {formatValue(swap.in)}
            </span>
            <span style={{ color: 'var(--dim)' }}>→</span>
            <span className="tnum" style={{ color: 'var(--deep)' }}>
              {formatValue(swap.out)}
            </span>
            <span style={{ color: 'var(--dim)' }}>via {programName(swap.program)}</span>
          </li>
        ))}
      </Section>

      <Section title="Events" count={tx.events.length}>
        {tx.events.map((event, index) => (
          <li key={index} className="flex flex-wrap items-baseline gap-x-2">
            <span style={{ color: 'var(--dim)' }}>{programName(event.program)}</span>
            <span className="tnum" style={{ color: 'var(--deep)' }}>
              {event.discriminator}
            </span>
            <span style={{ color: 'var(--dim)' }}>
              {event.source === 'cpi' ? 'self-CPI' : 'log'}
            </span>
          </li>
        ))}
      </Section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.625rem] uppercase tracking-[0.16em]" style={{ color: 'var(--dim)' }}>
        {label}
      </dt>
      <dd className="tnum mt-1 text-sm">{children}</dd>
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
    <div className="mt-5">
      <p className="text-[0.625rem] uppercase tracking-[0.16em]" style={{ color: 'var(--dim)' }}>
        {title} · {count}
      </p>
      <ul className="mt-2 space-y-1.5 text-sm">{children}</ul>
    </div>
  );
}
