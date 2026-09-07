import { findSymbols } from '../store/tokens';
import type { ActivityRow, SwapRow, TransferRow } from '../store/read';

/**
 * Symbols for one response.
 *
 * A route reads its rows, collects the mints in them, and looks all of them up
 * in a single query before serializing. So a page of 100 swaps costs one extra
 * primary-key lookup, not 200 — and the symbol arrives with the row rather than
 * after it, which is what keeps the console from reflowing a moment later.
 */

export type Symbols = ReadonlyMap<string, string>;

/** For serializing rows outside a request, where no lookup has been done. */
export const NO_SYMBOLS: Symbols = new Map();

export async function symbolsOf(mints: (string | null | undefined)[]): Promise<Symbols> {
  return findSymbols(mints.filter((mint): mint is string => typeof mint === 'string'));
}

export function transferMints(rows: TransferRow[]): string[] {
  return rows.map((row) => row.mint);
}

export function swapMints(rows: SwapRow[]): string[] {
  return rows.flatMap((row) => [row.in_mint, row.out_mint]);
}

export function activityMints(rows: ActivityRow[]): (string | null)[] {
  return rows.flatMap((row) => [row.primary_mint, row.counter_mint]);
}
