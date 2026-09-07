import { describe, expect, it } from 'vitest';
import { extractTransfers } from '../../src/extract/transfers';
import { flattenAccountKeys } from '../../src/extract/accounts';
import { NATIVE_SOL_MINT } from '../../src/domain/types';
import { SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../../src/chain/programs';
import {
  address,
  buildTransaction,
  instruction,
  systemTransferData,
  tokenBalance,
  tokenTransferCheckedData,
  tokenTransferData,
} from '../fixtures/build';

const payer = address('payer');
const recipient = address('recipient');
const sourceAta = address('source-ata');
const destAta = address('dest-ata');
const alice = address('alice');
const bob = address('bob');
const USDC = address('usdc');

function transfersOf(tx: ReturnType<typeof buildTransaction>) {
  return extractTransfers(tx, flattenAccountKeys(tx));
}

describe('native SOL transfers', () => {
  it('extracts a top-level System transfer', () => {
    const tx = buildTransaction({
      accountKeys: [payer, recipient, SYSTEM_PROGRAM],
      instructions: [instruction(2, [0, 1], systemTransferData(2_500_000_000n))],
    });

    const [transfer] = transfersOf(tx);

    expect(transfer).toMatchObject({
      kind: 'sol',
      source: payer,
      destination: recipient,
      amount: 2_500_000_000n,
      mint: NATIVE_SOL_MINT,
      decimals: 9,
    });
  });

  it('extracts transfers invoked through CPI', () => {
    const tx = buildTransaction({
      accountKeys: [payer, recipient, SYSTEM_PROGRAM],
      instructions: [instruction(2, [], new Uint8Array([9]))],
      innerInstructions: [
        { index: 0, instructions: [instruction(2, [0, 1], systemTransferData(1_000n))] },
      ],
    });

    const [transfer] = transfersOf(tx);

    expect(transfer.amount).toBe(1_000n);
    expect(transfer.innerIndex).toBe(0);
  });

  it('ignores non-transfer System instructions', () => {
    const tx = buildTransaction({
      accountKeys: [payer, recipient, SYSTEM_PROGRAM],
      instructions: [instruction(2, [0, 1], new Uint8Array([0, 0, 0, 0]))],
    });

    expect(transfersOf(tx)).toEqual([]);
  });
});

describe('SPL token transfers', () => {
  const keys = [alice, sourceAta, USDC, destAta, TOKEN_PROGRAM];

  it('reads mint and decimals straight from TransferChecked', () => {
    const tx = buildTransaction({
      accountKeys: keys,
      instructions: [instruction(4, [1, 2, 3, 0], tokenTransferCheckedData(1_250_000n, 6))],
    });

    const [transfer] = transfersOf(tx);

    expect(transfer).toMatchObject({
      kind: 'spl',
      source: sourceAta,
      destination: destAta,
      amount: 1_250_000n,
      mint: USDC,
      decimals: 6,
    });
  });

  it('recovers the mint for a plain Transfer from the balance snapshots', () => {
    const tx = buildTransaction({
      accountKeys: keys,
      instructions: [instruction(4, [1, 3, 0], tokenTransferData(500n))],
      preTokenBalances: [tokenBalance(1, USDC, alice, 9_000_000n)],
      postTokenBalances: [tokenBalance(3, USDC, bob, 500n)],
    });

    const [transfer] = transfersOf(tx);

    expect(transfer.mint).toBe(USDC);
    // Those same snapshots are what let a wallet lookup find this by owner
    // rather than only by token account.
    expect(transfer.sourceOwner).toBe(alice);
    expect(transfer.destinationOwner).toBe(bob);
  });

  it('skips a plain Transfer whose mint cannot be resolved', () => {
    const tx = buildTransaction({
      accountKeys: keys,
      instructions: [instruction(4, [1, 3, 0], tokenTransferData(500n))],
    });

    expect(transfersOf(tx)).toEqual([]);
  });

  it('treats Token-2022 the same as SPL Token', () => {
    const tx = buildTransaction({
      accountKeys: [alice, sourceAta, USDC, destAta, TOKEN_2022_PROGRAM],
      instructions: [instruction(4, [1, 2, 3, 0], tokenTransferCheckedData(7n, 6))],
    });

    expect(transfersOf(tx)[0].amount).toBe(7n);
  });

  it('leaves owners null when no snapshot covers the accounts', () => {
    const tx = buildTransaction({
      accountKeys: keys,
      instructions: [instruction(4, [1, 2, 3, 0], tokenTransferCheckedData(1n, 6))],
    });

    const [transfer] = transfersOf(tx);

    expect(transfer.sourceOwner).toBeNull();
    expect(transfer.destinationOwner).toBeNull();
  });
});

describe('failed transactions', () => {
  it('produce no transfers, because the instructions were rolled back', () => {
    const tx = buildTransaction({
      err: 'AQAAAA==',
      accountKeys: [payer, recipient, SYSTEM_PROGRAM],
      instructions: [instruction(2, [0, 1], systemTransferData(999n))],
    });

    expect(transfersOf(tx)).toEqual([]);
  });
});

describe('unrelated programs', () => {
  it('are ignored, since nothing decodes their instructions', () => {
    const other = address('other-program');

    const tx = buildTransaction({
      accountKeys: [payer, recipient, other],
      instructions: [instruction(2, [0, 1], systemTransferData(1n))],
    });

    expect(transfersOf(tx)).toEqual([]);
  });
});
