import { isInfrastructure } from '../chain/programs';
import {
  NATIVE_SOL_MINT,
  SOL_DECIMALS,
  WRAPPED_SOL_MINT,
  type IndexedSwap,
  type RawTransaction,
} from '../domain/types';

/**
 * Swaps, inferred from what balances actually did.
 *
 * No DEX's instruction format is decoded anywhere in this file. A swap is
 * defined here as its effect — one owner ended the transaction holding less of
 * one asset and more of another — which is true of every venue, including ones
 * that did not exist when this was written, and stays true when they ship a new
 * program version.
 *
 * What it cannot do is split a multi-hop route into its legs: routing USDC to
 * BONK through SOL is recorded as USDC in, BONK out, because that is what the
 * balances show. The programs the route went through are kept in
 * `routePrograms` so the path is not lost entirely.
 *
 * Four rules keep the noise out, and each one is load-bearing:
 *
 *  1. **The owner must have signed.** A pool's token accounts move in exact
 *     opposition to the trader's, so without this every swap would be recorded
 *     twice — once forwards for the user and once backwards for the pool. Pool
 *     authorities are program-derived and never sign a transaction; the person
 *     doing the swapping does.
 *  2. **Some program beyond plumbing must have run.** Paying rent to open a
 *     token account spends SOL while tokens arrive, which has the exact shape
 *     of a small purchase. A transaction that only touched System, Token and
 *     the associated-token program was doing bookkeeping, not trading.
 *  3. **Small SOL movements are ignored when tokens also moved.** Fees and rent
 *     are SOL-denominated noise on top of a token trade.
 *  4. **Wrapping is not swapping.** SOL to wrapped SOL is the same asset in a
 *     different container.
 */

/**
 * Below this, a native SOL movement alongside a token movement is treated as
 * overhead rather than as a leg of the trade. Opening a token account costs
 * about 0.00204 SOL in rent and a signature costs 0.000005, so this sits above
 * the noise and below any trade worth recording.
 */
const SOL_NOISE_LAMPORTS = 5_000_000n;

interface Delta {
  mint: string;
  amount: bigint;
  decimals: number | null;
}

/** Net movement per owner per mint, from the token balance snapshots. */
function tokenDeltas(tx: RawTransaction): Map<string, Map<string, Delta>> {
  const byOwner = new Map<string, Map<string, Delta>>();

  const apply = (
    owner: string | null,
    mint: string,
    amount: bigint,
    decimals: number,
    sign: bigint,
  ) => {
    if (!owner || !mint) return;

    const mints = byOwner.get(owner) ?? new Map<string, Delta>();
    const current = mints.get(mint) ?? { mint, amount: 0n, decimals };

    mints.set(mint, { mint, amount: current.amount + sign * amount, decimals });
    byOwner.set(owner, mints);
  };

  for (const balance of tx.preTokenBalances) {
    apply(balance.owner, balance.mint, balance.amount, balance.decimals, -1n);
  }
  for (const balance of tx.postTokenBalances) {
    apply(balance.owner, balance.mint, balance.amount, balance.decimals, 1n);
  }

  return byOwner;
}

/**
 * Native SOL movement per address. The fee is charged to the payer on top of
 * whatever else happened, so it is added back — otherwise every fee payer looks
 * like it spent SOL it did not trade away.
 */
function nativeDeltas(tx: RawTransaction, keys: string[]): Map<string, bigint> {
  const deltas = new Map<string, bigint>();
  const feePayer = keys[0] ?? null;

  const length = Math.min(tx.preBalances.length, tx.postBalances.length);

  for (let i = 0; i < length; i++) {
    const address = keys[i];
    if (!address) continue;

    let delta = tx.postBalances[i] - tx.preBalances[i];
    if (address === feePayer) delta += tx.fee;

    if (delta !== 0n) deltas.set(address, delta);
  }

  return deltas;
}

/** Every non-infrastructure program the transaction invoked, in first-seen order. */
function routePrograms(programIds: string[]): string[] {
  return programIds.filter((programId) => !isInfrastructure(programId));
}

/** SOL in one direction and wrapped SOL in the other is a wrap, not a trade. */
function isWrap(inMint: string, outMint: string): boolean {
  const pair = new Set([inMint, outMint]);

  return pair.has(NATIVE_SOL_MINT) && pair.has(WRAPPED_SOL_MINT);
}

/**
 * Swaps performed by the transaction's signers.
 *
 * `programIds` is every program the transaction invoked, in invocation order,
 * which is what decides who gets credited with the swap.
 */
export function extractSwaps(
  tx: RawTransaction,
  keys: string[],
  signers: string[],
  programIds: string[],
): IndexedSwap[] {
  // A failed transaction's balances were rolled back, so there is nothing to
  // read: whatever the instructions intended, no value moved.
  if (tx.err !== null) return [];

  const route = routePrograms(programIds);
  if (route.length === 0) return [];

  const signing = new Set(signers);
  const tokens = tokenDeltas(tx);
  const native = nativeDeltas(tx, keys);

  const owners = new Set([...tokens.keys(), ...native.keys()].filter((o) => signing.has(o)));
  const swaps: IndexedSwap[] = [];

  for (const owner of owners) {
    const deltas: Delta[] = [...(tokens.get(owner)?.values() ?? [])].filter((d) => d.amount !== 0n);

    const solDelta = native.get(owner) ?? 0n;
    const solIsNoise = deltas.length > 0 && absolute(solDelta) < SOL_NOISE_LAMPORTS;

    if (solDelta !== 0n && !solIsNoise) {
      deltas.push({ mint: NATIVE_SOL_MINT, amount: solDelta, decimals: SOL_DECIMALS });
    }

    const spent = deltas.filter((d) => d.amount < 0n);
    const received = deltas.filter((d) => d.amount > 0n);

    // Exactly one of each is a swap that can be stated without guessing. Two
    // assets in or out is a route or a liquidity operation whose legs cannot be
    // separated from balances alone, so it is left out rather than guessed at.
    if (spent.length !== 1 || received.length !== 1) continue;

    const [given] = spent;
    const [taken] = received;

    if (isWrap(given.mint, taken.mint)) continue;

    swaps.push({
      owner,
      inMint: given.mint,
      inAmount: -given.amount,
      inDecimals: given.decimals,
      outMint: taken.mint,
      outAmount: taken.amount,
      outDecimals: taken.decimals,
      // The outermost non-infrastructure program is the one that was asked to
      // do this; anything deeper is a venue it routed through.
      programId: route[0],
      routePrograms: route,
    });
  }

  return swaps;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}
