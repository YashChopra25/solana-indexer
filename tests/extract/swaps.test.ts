import { describe, expect, it } from 'vitest';
import { extractSwaps } from '../../src/extract/swaps';
import { flattenAccountKeys, signersOf } from '../../src/extract/accounts';
import {
  NATIVE_SOL_MINT,
  WRAPPED_SOL_MINT,
  type RawTransaction,
} from '../../src/domain/types';
import { SYSTEM_PROGRAM, TOKEN_PROGRAM } from '../../src/chain/programs';
import { address, buildTransaction, tokenBalance } from '../fixtures/build';

/**
 * Swap detection is the one place this indexer infers rather than decodes, so
 * these tests are mostly about what it refuses to call a swap.
 */

const DEX = address('some-dex-program');
const trader = address('trader');
const pool = address('pool-authority');
const USDC = address('usdc');
const BONK = address('bonk');

const FEE = 5_000n;
const SOL = 1_000_000_000n;

/**
 * A transaction where `trader` signs and the balances say what each argument
 * says. Native balances are indexed by position in `accountKeys`, and the fee
 * payer is always the first key.
 */
function swapTx(options: {
  solDelta?: bigint;
  tokensBefore?: Array<[string, string, bigint]>;
  tokensAfter?: Array<[string, string, bigint]>;
  err?: string | null;
}): RawTransaction {
  const { solDelta = 0n, tokensBefore = [], tokensAfter = [], err = null } = options;

  // The fee is charged on top of whatever the transaction did, so a caller
  // asking for a net delta of zero still pays it.
  const pre = 100n * SOL;
  const post = pre + solDelta - FEE;

  return buildTransaction({
    err,
    fee: FEE,
    accountKeys: [trader, pool, DEX],
    numRequiredSignatures: 1,
    preBalances: [pre, 10n * SOL, 0n],
    postBalances: [post, 10n * SOL, 0n],
    preTokenBalances: tokensBefore.map(([owner, mint, amount], i) =>
      tokenBalance(i + 3, mint, owner, amount),
    ),
    postTokenBalances: tokensAfter.map(([owner, mint, amount], i) =>
      tokenBalance(i + 3, mint, owner, amount),
    ),
  });
}

function swapsOf(tx: RawTransaction, programIds: string[] = [DEX]) {
  return extractSwaps(tx, flattenAccountKeys(tx), signersOf(tx), programIds);
}

describe('a plain swap', () => {
  const tx = swapTx({
    solDelta: SOL,
    tokensBefore: [[trader, USDC, 100_000_000n]],
    tokensAfter: [[trader, USDC, 0n]],
  });

  it('records what the signer gave and what they got', () => {
    const [swap] = swapsOf(tx);

    expect(swap.owner).toBe(trader);
    expect(swap.inMint).toBe(USDC);
    expect(swap.inAmount).toBe(100_000_000n);
    expect(swap.outMint).toBe(NATIVE_SOL_MINT);
    expect(swap.outAmount).toBe(SOL);
  });

  it('credits the outermost non-infrastructure program', () => {
    const [swap] = swapsOf(tx, [SYSTEM_PROGRAM, DEX, TOKEN_PROGRAM]);

    expect(swap.programId).toBe(DEX);
    // Plumbing is not part of the route.
    expect(swap.routePrograms).toEqual([DEX]);
  });

  it('does not count the fee as part of the trade', () => {
    // The signer received exactly 1 SOL and paid the fee on top; if the fee
    // leaked in, the amount would be short by exactly that.
    expect(swapsOf(tx)[0].outAmount).toBe(SOL);
  });

  it('works between two tokens with no SOL leg at all', () => {
    const tokenToToken = swapTx({
      tokensBefore: [[trader, USDC, 100_000_000n], [trader, BONK, 0n]],
      tokensAfter: [[trader, USDC, 0n], [trader, BONK, 42_000n]],
    });

    const [swap] = swapsOf(tokenToToken);

    expect(swap.inMint).toBe(USDC);
    expect(swap.outMint).toBe(BONK);
    expect(swap.outAmount).toBe(42_000n);
  });
});

describe('what is not a swap', () => {
  it('ignores the pool, whose balances mirror the trade exactly', () => {
    // The pool gains the USDC the trader spent and loses the SOL they gained.
    // Without the signer rule this would be recorded as a second, reversed swap.
    const tx = swapTx({
      solDelta: SOL,
      tokensBefore: [[trader, USDC, 100_000_000n], [pool, USDC, 0n]],
      tokensAfter: [[trader, USDC, 0n], [pool, USDC, 100_000_000n]],
    });

    const swaps = swapsOf(tx);

    expect(swaps).toHaveLength(1);
    expect(swaps[0].owner).toBe(trader);
  });

  it('ignores a transaction that only touched infrastructure programs', () => {
    // Receiving tokens while paying rent for the account has the same balance
    // shape as a small purchase. The programs involved are what tell them apart.
    const tx = swapTx({
      solDelta: -2_039_280n,
      tokensBefore: [[trader, USDC, 0n]],
      tokensAfter: [[trader, USDC, 100_000_000n]],
    });

    expect(swapsOf(tx, [SYSTEM_PROGRAM, TOKEN_PROGRAM])).toEqual([]);
  });

  it('treats a rent-sized SOL movement beside a token as overhead', () => {
    // Same shape as above but with a real program present: the SOL leg is still
    // noise, which leaves one direction only, which is not a swap.
    const tx = swapTx({
      solDelta: -2_039_280n,
      tokensBefore: [[trader, USDC, 0n]],
      tokensAfter: [[trader, USDC, 100_000_000n]],
    });

    expect(swapsOf(tx)).toEqual([]);
  });

  it('keeps a SOL leg that is too large to be rent', () => {
    const tx = swapTx({
      solDelta: -SOL,
      tokensBefore: [[trader, USDC, 0n]],
      tokensAfter: [[trader, USDC, 100_000_000n]],
    });

    const [swap] = swapsOf(tx);

    expect(swap.inMint).toBe(NATIVE_SOL_MINT);
    expect(swap.inAmount).toBe(SOL);
  });

  it('does not call wrapping SOL a swap', () => {
    const tx = swapTx({
      solDelta: -SOL,
      tokensBefore: [[trader, WRAPPED_SOL_MINT, 0n]],
      tokensAfter: [[trader, WRAPPED_SOL_MINT, SOL]],
    });

    expect(swapsOf(tx)).toEqual([]);
  });

  it('produces nothing for a failed transaction', () => {
    const tx = swapTx({
      solDelta: SOL,
      tokensBefore: [[trader, USDC, 100_000_000n]],
      tokensAfter: [[trader, USDC, 0n]],
      err: 'AQAAAA==',
    });

    expect(swapsOf(tx)).toEqual([]);
  });

  it('skips a movement it cannot state without guessing', () => {
    // Two assets in and one out is a liquidity operation or a route whose legs
    // balances alone cannot separate.
    const tx = swapTx({
      tokensBefore: [[trader, USDC, 100_000_000n], [trader, BONK, 42_000n], [trader, WRAPPED_SOL_MINT, 0n]],
      tokensAfter: [[trader, USDC, 0n], [trader, BONK, 0n], [trader, WRAPPED_SOL_MINT, SOL]],
    });

    expect(swapsOf(tx)).toEqual([]);
  });

  it('produces nothing when no program beyond plumbing ran', () => {
    const tx = swapTx({
      solDelta: SOL,
      tokensBefore: [[trader, USDC, 100_000_000n]],
      tokensAfter: [[trader, USDC, 0n]],
    });

    expect(swapsOf(tx, [])).toEqual([]);
  });

  it('ignores an owner who did not sign, even with a clean two-sided move', () => {
    const tx = swapTx({
      tokensBefore: [[pool, USDC, 100_000_000n], [pool, BONK, 0n]],
      tokensAfter: [[pool, USDC, 0n], [pool, BONK, 42_000n]],
    });

    expect(swapsOf(tx)).toEqual([]);
  });
});

describe('two signers trading in one transaction', () => {
  it('records one swap each', () => {
    const other = address('other-trader');

    const tx = buildTransaction({
      fee: FEE,
      accountKeys: [trader, other, DEX],
      numRequiredSignatures: 2,
      preBalances: [100n * SOL, 100n * SOL, 0n],
      postBalances: [100n * SOL - FEE, 100n * SOL, 0n],
      preTokenBalances: [
        tokenBalance(3, USDC, trader, 100_000_000n),
        tokenBalance(4, BONK, trader, 0n),
        tokenBalance(5, BONK, other, 42_000n),
        tokenBalance(6, USDC, other, 0n),
      ],
      postTokenBalances: [
        tokenBalance(3, USDC, trader, 0n),
        tokenBalance(4, BONK, trader, 42_000n),
        tokenBalance(5, BONK, other, 0n),
        tokenBalance(6, USDC, other, 100_000_000n),
      ],
    });

    const swaps = swapsOf(tx).sort((a, b) => a.owner.localeCompare(b.owner));

    expect(swaps).toHaveLength(2);
    expect(swaps.map((s) => s.inMint).sort()).toEqual([BONK, USDC].sort());
  });
});
