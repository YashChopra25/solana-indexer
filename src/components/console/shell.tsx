'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Health } from '@/lib/format';

/**
 * The frame every page sits in: the title, the nav, and one honest indicator of
 * whether data is still arriving.
 */

const LABEL: Record<Health, string> = {
  idle: 'waiting for data',
  live: 'live',
  lagging: 'falling behind',
  stalled: 'stalled',
};

function toneOf(health: Health): string {
  return health === 'live' ? 'var(--deep)' : health === 'idle' ? 'var(--dim)' : 'var(--signal)';
}

const PAGES = [
  { href: '/', label: 'Activity' },
  { href: '/swaps', label: 'Swaps' },
  { href: '/events', label: 'Events' },
  { href: '/watching', label: 'Watching' },
];

export function StatusRail({ health, detail }: { health: Health; detail: string }) {
  const tone = toneOf(health);
  const pathname = usePathname();

  return (
    <header
      className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b px-5 py-3 backdrop-blur-sm sm:px-8"
      style={{
        borderColor: 'var(--rule)',
        background: 'color-mix(in oklab, var(--ground) 88%, transparent)',
      }}
    >
      <div className="flex items-baseline gap-6">
        <h1 className="font-display text-[0.8125rem] font-700 uppercase tracking-[0.22em]">
          Solana Indexer
        </h1>

        <nav className="flex items-baseline gap-4 text-[0.6875rem] uppercase tracking-[0.16em]">
          {PAGES.map((page) => {
            const current = pathname === page.href;

            return (
              <Link
                key={page.href}
                href={page.href}
                aria-current={current ? 'page' : undefined}
                className="border-b pb-0.5 transition-colors"
                style={{
                  color: current ? 'var(--ink)' : 'var(--dim)',
                  borderColor: current ? 'var(--ink)' : 'transparent',
                }}
              >
                {page.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-4 text-[0.6875rem] uppercase tracking-[0.16em]">
        <span className="hidden sm:inline" style={{ color: 'var(--dim)' }}>
          {detail}
        </span>

        <span className="flex items-center gap-2" style={{ color: tone }}>
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
        </span>
      </div>
    </header>
  );
}

/** A page's heading: what you are looking at, and the one number that matters. */
export function PageHead({
  eyebrow,
  value,
  note,
  tone = 'var(--ink)',
}: {
  eyebrow: string;
  value: string;
  note: string;
  tone?: string;
}) {
  return (
    <section className="px-5 pb-6 pt-10 sm:px-8 sm:pb-8 sm:pt-14">
      <p className="text-[0.6875rem] uppercase tracking-[0.22em]" style={{ color: 'var(--dim)' }}>
        {eyebrow}
      </p>

      <p
        className="tnum font-display mt-3 text-6xl font-700 leading-none tracking-tight sm:text-7xl"
        style={{ color: tone }}
      >
        {value}
      </p>

      <p
        className="mt-3 text-[0.6875rem] uppercase tracking-[0.16em]"
        style={{ color: 'var(--dim)' }}
      >
        {note}
      </p>
    </section>
  );
}

/**
 * The counters rail: readings off one instrument, not several separate facts.
 *
 * The dividers are the container's own background showing through a 1px grid
 * gap. That only works while every row is full — a half-empty row lets the same
 * background through as a phantom cell — so the column count is driven by how
 * many counters there actually are rather than fixed in a utility class.
 */
export function CounterRail({ counters }: { counters: { label: string; value: number }[] }) {
  return (
    <dl
      className="counter-rail grid grid-cols-2 gap-px border-y"
      style={{
        borderColor: 'var(--rule)',
        background: 'var(--rule)',
        ['--counters' as string]: counters.length,
      }}
    >
      {counters.map((counter) => (
        <div
          key={counter.label}
          className="px-5 py-4 sm:py-5"
          style={{ background: 'var(--ground)' }}
        >
          <dt className="text-[0.625rem] uppercase tracking-[0.18em]" style={{ color: 'var(--dim)' }}>
            {counter.label}
          </dt>
          <dd className="tnum font-display mt-1.5 text-2xl font-600" style={{ color: 'var(--ink)' }}>
            {counter.value.toLocaleString()}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Table furniture, so every feed on the site rules its columns the same way. */
export function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      className={`border-b py-2 pr-4 font-400 whitespace-nowrap ${align === 'right' ? 'text-right' : ''}`}
      style={{ borderColor: 'var(--rule)' }}
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
      className={`tnum py-2.5 pr-4 ${align === 'right' ? 'text-right' : ''}`}
      style={{ color }}
      title={title}
    >
      {children}
    </td>
  );
}

/** The one place a feed says it is empty, failed, or still reading. */
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
  if (error) {
    return (
      <p className="mt-6 max-w-lg text-sm leading-relaxed" style={{ color: 'var(--signal)' }}>
        {error}
      </p>
    );
  }

  if (!empty) return null;

  return (
    <p className="mt-6 max-w-lg text-sm leading-relaxed" style={{ color: 'var(--dim)' }}>
      {loading ? 'Reading the index…' : emptyMessage}
    </p>
  );
}
