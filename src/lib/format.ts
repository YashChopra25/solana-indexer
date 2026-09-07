import type { Amount, ProgramRef } from './api-types';

/** Presentation helpers shared across the console. */

const NUMBER = new Intl.NumberFormat('en-US');

/**
 * Native SOL is recorded under a sentinel rather than a real mint, because it
 * has no mint account. The console should never show it as an address.
 */
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111111';
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : NUMBER.format(value);
}

/** Middle-truncates a base58 address so both ends stay recognizable. */
export function truncate(value: string, lead = 4, tail = 4): string {
  return value.length <= lead + tail + 1 ? value : `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

/**
 * Renders a raw on-chain amount using its mint's decimals. Amounts arrive as
 * strings because they can exceed Number.MAX_SAFE_INTEGER, and they are scaled
 * here with BigInt so that stays true.
 */
export function formatAmount(raw: string, decimals: number | null): string {
  if (decimals === null) return raw;

  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    return raw;
  }

  const negative = value < 0n;
  if (negative) value = -value;

  if (decimals === 0) return `${negative ? '-' : ''}${NUMBER.format(value)}`;

  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');

  const rendered = fraction ? `${NUMBER.format(whole)}.${fraction}` : NUMBER.format(whole);

  return `${negative ? '-' : ''}${rendered}`;
}

/** An amount and its asset, the way a row of the feed shows it. */
export function formatValue(value: Amount | null): string {
  if (!value) return '—';

  return `${formatAmount(value.amount, value.decimals)} ${assetLabel(value.mint, value.symbol)}`;
}

/**
 * Display name for an asset, in strict order of trust.
 *
 * The two sentinels come first and a token list cannot override them. That is
 * not a detail: every list calls the wrapped-SOL mint "SOL", so deferring to
 * one would collapse SOL and wSOL into the same label — and telling them apart
 * is exactly what stops a wrap from reading as a trade (`extract/swaps.ts`).
 *
 * After that, a symbol if one is known, and otherwise the mint itself,
 * shortened. The fallback is the ordinary case rather than the exception: most
 * mints an unfiltered indexer meets are listed nowhere.
 */
export function assetLabel(mint: string, symbol?: string | null): string {
  if (mint === NATIVE_SOL_MINT) return 'SOL';
  if (mint === WRAPPED_SOL_MINT) return 'wSOL';
  if (symbol) return symbol;

  return truncate(mint, 4, 4);
}

/**
 * The width the console reserves for an asset label, in characters.
 *
 * A shortened mint is always exactly this wide (`4 + ellipsis + 4`), and it is
 * what most rows show. Pinning symbols to the same width means a feed that
 * refreshes every two seconds never reflows its columns as rows come and go —
 * a named token and an unnamed one occupy the same space.
 */
export const ASSET_LABEL_CH = 9;

/** A program's label if it has one, otherwise its truncated id. */
export function programName(program: ProgramRef): string {
  return program.label ?? truncate(program.id, 4, 4);
}

export function formatLag(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export type Health = 'idle' | 'live' | 'lagging' | 'stalled';

/**
 * Classifies indexer health from block-time lag. Solana produces a block
 * roughly every 400ms, so more than a minute behind is a real problem and more
 * than five means the stream has almost certainly stopped.
 */
export function classifyHealth(lagSeconds: number | null, slotsProcessed: number): Health {
  if (slotsProcessed === 0 || lagSeconds === null) return 'idle';
  if (lagSeconds > 300) return 'stalled';
  if (lagSeconds > 60) return 'lagging';

  return 'live';
}
