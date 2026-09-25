'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { truncate, type Health } from '@/lib/format';

/**
 * The frame every page sits in: the title, the nav, and one honest indicator of
 * whether data is still arriving — worded for someone who has never run a node.
 */

const LABEL: Record<Health, string> = {
  idle: 'Starting up',
  live: 'Live',
  lagging: 'Running behind',
  stalled: 'Stopped',
};

export function toneOf(health: Health): string {
  return health === 'live' ? 'var(--deep)' : health === 'idle' ? 'var(--dim)' : 'var(--signal)';
}

const PAGES = [
  { href: '/', label: 'Live feed' },
  { href: '/swaps', label: 'Trades' },
  { href: '/events', label: 'App events' },
  { href: '/watching', label: 'Watchlist' },
];

export function StatusRail({ health, detail }: { health: Health; detail: string }) {
  const tone = toneOf(health);
  const pathname = usePathname();

  return (
    <header
      className="sticky top-0 z-20 border-b backdrop-blur-xl"
      style={{
        borderColor: 'var(--rule)',
        background: 'color-mix(in oklab, var(--ground) 72%, transparent)',
      }}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="font-display text-base font-700 tracking-tight">
            Solana <span className="grad-text">Indexer</span>
          </span>
        </Link>

        <span
          className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs sm:order-last"
          style={{ borderColor: 'var(--rule-strong)', color: tone }}
          title={detail}
        >
          <span className="relative flex size-2">
            {/* The dot pulses only while data is flowing, so a still page reads
                as a stopped indexer rather than as a working one. */}
            {health === 'live' && (
              <span
                className="absolute inline-flex size-full animate-ping rounded-full opacity-70"
                style={{ background: tone }}
              />
            )}
            <span className="relative inline-flex size-2 rounded-full" style={{ background: tone }} />
          </span>
          {LABEL[health]}
          <span className="hidden md:inline" style={{ color: 'var(--dim)' }}>
            · {detail}
          </span>
        </span>

        <nav className="no-scrollbar -mx-1 flex w-full gap-1 overflow-x-auto text-sm sm:mx-0 sm:w-auto">
          {PAGES.map((page) => {
            const current = pathname === page.href;

            return (
              <Link
                key={page.href}
                href={page.href}
                aria-current={current ? 'page' : undefined}
                className="shrink-0 rounded-full px-3.5 py-1.5 transition-colors"
                style={{
                  color: current ? 'var(--ink)' : 'var(--dim)',
                  background: current
                    ? 'color-mix(in oklab, var(--violet) 22%, transparent)'
                    : 'transparent',
                }}
              >
                {page.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

/** Solana's three stacked bars, drawn rather than shipped as an image. */
function Logo() {
  return (
    <svg viewBox="0 0 24 20" className="h-4 w-5" aria-hidden>
      <defs>
        <linearGradient id="logo-gradient" x1="0" x2="1" y1="1" y2="0">
          <stop offset="0" stopColor="#9945ff" />
          <stop offset="1" stopColor="#14f195" />
        </linearGradient>
      </defs>
      <g fill="url(#logo-gradient)">
        <path d="M4 0h20l-4 4H0z" />
        <path d="M0 8h20l4 4H4z" />
        <path d="M4 16h20l-4 4H0z" />
      </g>
    </svg>
  );
}

/**
 * A page's heading: what you are looking at, the one number that matters, and
 * a sentence saying what that number means for someone new to the chain.
 */
export function PageHead({
  eyebrow,
  value,
  note,
  explain,
  tone,
  children,
}: {
  eyebrow: string;
  value: string;
  note?: string;
  explain?: React.ReactNode;
  /** Colours the value flat; without it the value takes the brand gradient. */
  tone?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="px-4 pb-6 pt-10 sm:px-8 sm:pb-8 sm:pt-14">
      <p className="text-xs uppercase tracking-[0.2em]" style={{ color: 'var(--dim)' }}>
        {eyebrow}
      </p>

      <p
        className={`tnum font-display mt-3 break-all text-5xl font-700 leading-none tracking-tight sm:text-7xl ${tone ? '' : 'grad-text'}`}
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </p>

      {note && (
        <p className="mt-3 break-all text-xs" style={{ color: 'var(--dim)' }}>
          {note}
        </p>
      )}

      {explain && (
        <p className="mt-4 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--dim)' }}>
          {explain}
        </p>
      )}

      {children}
    </section>
  );
}

/**
 * The counters: readings off one instrument, each a card with a one-line hint
 * so a newcomer knows what is being counted.
 */
export function CounterRail({
  counters,
}: {
  counters: { label: string; value: number; hint?: string }[];
}) {
  return (
    <dl
      className="counter-rail mx-4 grid grid-cols-2 gap-3 sm:mx-8"
      style={{ ['--counters' as string]: counters.length }}
    >
      {counters.map((counter) => (
        <div key={counter.label} className="panel px-4 py-4" title={counter.hint}>
          <dt className="text-xs" style={{ color: 'var(--dim)' }}>
            {counter.label}
          </dt>
          <dd className="tnum font-display mt-1 text-2xl font-600" style={{ color: 'var(--ink)' }}>
            {counter.value.toLocaleString()}
          </dd>
          {counter.hint && (
            <p className="mt-1 text-[0.6875rem] leading-snug" style={{ color: 'var(--dim)' }}>
              {counter.hint}
            </p>
          )}
        </div>
      ))}
    </dl>
  );
}

/** A section title with a plain-language line under it. */
export function SectionHead({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-xl font-600 tracking-tight">{title}</h2>
        {hint && (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--dim)' }}>
            {hint}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * An address as the console shows it: shortened, linkable, and copyable in
 * one click — because the full string is what anyone acting on it needs.
 */
export function Address({
  value,
  href,
  lead = 4,
  tail = 4,
}: {
  value: string;
  href?: string;
  lead?: number;
  tail?: number;
}) {
  const [copied, setCopied] = useState(false);
  const short = truncate(value, lead, tail);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_200);
    } catch {
      // Clipboard access can be refused; the full value is still on `title`.
    }
  }

  return (
    <span className="group inline-flex items-center gap-1.5 whitespace-nowrap" title={value}>
      {href ? (
        <Link href={href} className="underline-offset-4 hover:underline" style={{ color: 'var(--ink)' }}>
          {short}
        </Link>
      ) : (
        <span>{short}</span>
      )}
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${value}`}
        className="text-[0.6875rem] opacity-40 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        style={{ color: copied ? 'var(--deep)' : 'var(--dim)' }}
      >
        {copied ? '✓' : '⧉'}
      </button>
    </span>
  );
}

/** A small rounded label, tinted by what it means. */
export function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs whitespace-nowrap"
      style={{ color: tone, background: `color-mix(in oklab, ${tone} 14%, transparent)` }}
    >
      {children}
    </span>
  );
}

/** A table inside a panel, scrolling sideways on narrow screens. */
export function Table({
  minWidth,
  head,
  children,
}: {
  minWidth: string;
  head: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="panel mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        <thead>
          <tr className="text-left text-xs" style={{ color: 'var(--dim)' }}>
            {head}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { children: React.ReactNode }) {
  return (
    <tr className="row border-t" style={{ borderColor: 'var(--rule)' }}>
      {children}
    </tr>
  );
}

/** Table furniture, so every feed on the site rules its columns the same way. */
export function Th({ children, align }: { children?: React.ReactNode; align?: 'right' }) {
  return (
    <th
      className={`px-4 py-3 font-500 whitespace-nowrap ${align === 'right' ? 'text-right' : ''}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align,
  color,
  title,
}: {
  children: React.ReactNode;
  align?: 'right';
  color?: string;
  title?: string;
}) {
  return (
    <td
      className={`tnum px-4 py-3 whitespace-nowrap ${align === 'right' ? 'text-right' : ''}`}
      style={{ color }}
      title={title}
    >
      {children}
    </td>
  );
}

/** "12s ago" over the block number, for the first column of every feed. */
export function When({ ago, slot }: { ago: string; slot: number }) {
  return (
    <span className="flex flex-col leading-tight" title={`Block (slot) ${slot.toLocaleString()}`}>
      <span style={{ color: 'var(--ink)' }}>{ago}</span>
      <span className="text-[0.6875rem]" style={{ color: 'var(--dim)' }}>
        #{slot.toLocaleString()}
      </span>
    </span>
  );
}

/**
 * The one place a feed says it is empty, failed, or still reading.
 *
 * A failure with rows already on screen is not treated as an outage: the rows
 * stay, and a quiet note says they may be out of date while polling retries.
 */
export function FeedState({
  error,
  loading,
  empty,
  emptyMessage,
}: {
  error: string | null;
  loading: boolean;
  empty: boolean;
  emptyMessage: string;
}) {
  if (error && !empty) {
    return (
      <p className="mt-3 text-xs" style={{ color: 'var(--signal)' }}>
        Connection hiccup — showing the last data received and retrying. ({error})
      </p>
    );
  }

  if (error) {
    return (
      <div className="panel mt-4 px-5 py-6 text-sm leading-relaxed" style={{ color: 'var(--signal)' }}>
        {error}
      </div>
    );
  }

  if (!empty) return null;

  return (
    <div className="panel mt-4 px-5 py-8 text-center text-sm leading-relaxed" style={{ color: 'var(--dim)' }}>
      {loading ? (
        <span className="animate-pulse">Reading the chain…</span>
      ) : (
        <span className="mx-auto block max-w-lg">{emptyMessage}</span>
      )}
    </div>
  );
}
