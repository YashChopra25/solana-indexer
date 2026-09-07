import { describe, expect, it } from 'vitest';
import { indexTransaction } from '../../src/extract/transaction';
import { NATIVE_SOL_MINT } from '../../src/domain/types';
import { SYSTEM_PROGRAM, TOKEN_PROGRAM } from '../../src/chain/programs';
import {
  address,
  buildTransaction,
  eventCpiData,
  instruction,
  systemTransferData,
  tokenBalance,
  tokenTransferCheckedData,
} from '../fixtures/build';

/**
 * The whole extractor end to end: one raw transaction in, four kinds of tracked
 * thing out.
 */

const trader = address('trader');
const DEX = address('dex-program');
const USDC = address('usdc');

describe('flattening', () => {
  it('appends lookup table addresses after the static keys, writable first', () => {
    const tx = buildTransaction({
      accountKeys: [address('a')],
      loadedWritableAddresses: [address('w')],
      loadedReadonlyAddresses: [address('r')],
    });

    expect(indexTransaction(tx).accounts).toEqual([address('a'), address('w'), address('r')]);
  });

  it('places inner instructions directly after their outer instruction', () => {
    const tx = buildTransaction({
      accountKeys: [address('a'), SYSTEM_PROGRAM],
      instructions: [instruction(1, [], new Uint8Array()), instruction(1, [], new Uint8Array())],
      innerInstructions: [{ index: 0, instructions: [instruction(1, [], new Uint8Array())] }],
    });

    expect(
      indexTransaction(tx).instructions.map((i) => [i.instructionIndex, i.innerIndex]),
    ).toEqual([
      [0, null],
      [0, 0],
      [1, null],
    ]);
  });

  it('marks an out-of-range account index rather than dropping the instruction', () => {
    const tx = buildTransaction({
      accountKeys: [address('a'), SYSTEM_PROGRAM],
      instructions: [instruction(1, [0, 99], new Uint8Array())],
    });

    expect(indexTransaction(tx).instructions[0].accounts).toEqual([address('a'), 'unknown:99']);
  });

  it('takes the fee payer from the first signer', () => {
    const tx = buildTransaction({ numRequiredSignatures: 1 });
    const indexed = indexTransaction(tx);

    expect(indexed.feePayer).toBe(indexed.signers[0]);
  });

  it('lists each invoked program once, outermost first', () => {
    const tx = buildTransaction({
      accountKeys: [address('a'), SYSTEM_PROGRAM, TOKEN_PROGRAM],
      instructions: [
        instruction(1, [], new Uint8Array()),
        instruction(2, [], new Uint8Array()),
        instruction(1, [], new Uint8Array()),
      ],
    });

    expect(indexTransaction(tx).programIds).toEqual([SYSTEM_PROGRAM, TOKEN_PROGRAM]);
  });
});

describe('one transaction, four kinds of record', () => {
  const tx = buildTransaction({
    accountKeys: [trader, address('src-ata'), USDC, address('dst-ata'), TOKEN_PROGRAM, DEX],
    numRequiredSignatures: 1,
    fee: 5_000n,
    instructions: [
      instruction(4, [1, 2, 3, 0], tokenTransferCheckedData(100_000_000n, 6)),
      instruction(5, [0], eventCpiData('0102030405060708')),
    ],
    preBalances: [100_000_000_000n, 0n, 0n, 0n, 0n, 0n],
    postBalances: [101_000_000_000n - 5_000n, 0n, 0n, 0n, 0n, 0n],
    preTokenBalances: [tokenBalance(1, USDC, trader, 100_000_000n)],
    postTokenBalances: [tokenBalance(1, USDC, trader, 0n)],
    logs: [`Program ${DEX} invoke [1]`, 'Program log: swapping', `Program ${DEX} success`],
  });

  const indexed = indexTransaction(tx);

  it('finds the transfer', () => {
    expect(indexed.transfers).toHaveLength(1);
    expect(indexed.transfers[0].mint).toBe(USDC);
  });

  it('finds the swap, from balances rather than from the instruction', () => {
    expect(indexed.swaps).toHaveLength(1);
    expect(indexed.swaps[0]).toMatchObject({
      owner: trader,
      inMint: USDC,
      inAmount: 100_000_000n,
      outMint: NATIVE_SOL_MINT,
      outAmount: 1_000_000_000n,
      programId: DEX,
    });
  });

  it('finds the event', () => {
    expect(indexed.events).toHaveLength(1);
    expect(indexed.events[0].discriminator).toBe('0102030405060708');
  });

  it('finds the program invocation and its logs', () => {
    expect(indexed.invocations).toHaveLength(1);
    expect(indexed.invocations[0].programId).toBe(DEX);
    expect(indexed.invocations[0].logs).toEqual(['Program log: swapping']);
  });

  it('collects the mint it saw', () => {
    expect(indexed.tokens.get(USDC)).toEqual({ decimals: 6, programId: TOKEN_PROGRAM });
  });
});

describe('failure', () => {
  it('indexes the transaction but extracts no value movement from it', () => {
    const tx = buildTransaction({
      err: 'AQAAAA==',
      accountKeys: [trader, SYSTEM_PROGRAM],
      instructions: [instruction(1, [0, 0], systemTransferData(1n))],
    });

    const indexed = indexTransaction(tx);

    expect(indexed.success).toBe(false);
    expect(indexed.err).toBe('AQAAAA==');
    expect(indexed.transfers).toEqual([]);
    expect(indexed.swaps).toEqual([]);
  });
});
