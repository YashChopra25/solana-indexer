import bs58 from 'bs58';
import type {
  RawInstruction,
  RawTokenBalance,
  RawTransaction,
} from '../../src/domain/types';
import { SYSTEM_PROGRAM, TOKEN_PROGRAM } from '../../src/chain/programs';

/**
 * Fixture builders. Real LaserStream payloads are large and mostly noise, so
 * each test constructs the minimum shape its case needs.
 */

/**
 * Deterministic bytes from a label.
 *
 * The label is hashed rather than copied in, so that two labels sharing a
 * prefix -- `sample-dex` and `sample-anchor` -- do not produce two addresses
 * sharing most of their base58, which makes seeded data unreadable.
 */
function bytesFrom(label: string, length: number): Uint8Array {
  const bytes = new Uint8Array(length);

  // FNV-1a, one byte at a time. Any spreading function would do; this one is
  // four lines and needs no dependency.
  let hash = 0x811c9dc5;
  for (let i = 0; i < length; i++) {
    hash ^= label.charCodeAt(i % label.length) + i;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    bytes[i] = hash & 0xff;
  }

  return bytes;
}

/** Deterministic 32-byte base58 address derived from a label. */
export function address(label: string): string {
  return bs58.encode(bytesFrom(label, 32));
}

export function signature(label: string): string {
  return bs58.encode(bytesFrom(label, 64));
}

/** System Transfer: u32 tag 2, then lamports as u64 LE. */
export function systemTransferData(lamports: bigint): Uint8Array {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);

  return data;
}

/** SPL Token Transfer: u8 tag 3, then amount as u64 LE. */
export function tokenTransferData(amount: bigint): Uint8Array {
  const data = new Uint8Array(9);
  data[0] = 3;
  new DataView(data.buffer).setBigUint64(1, amount, true);

  return data;
}

/** SPL Token TransferChecked: u8 tag 12, amount u64 LE, decimals u8. */
export function tokenTransferCheckedData(amount: bigint, decimals: number): Uint8Array {
  const data = new Uint8Array(10);
  data[0] = 12;
  new DataView(data.buffer).setBigUint64(1, amount, true);
  data[9] = decimals;

  return data;
}

/** An Anchor `emit_cpi!` payload: the event marker, then the discriminator. */
export function eventCpiData(discriminator: string, body = 16): Uint8Array {
  const marker = Buffer.from('e445a52e51cb9a1d', 'hex');
  const disc = Buffer.from(discriminator, 'hex');

  return Uint8Array.from(Buffer.concat([marker, disc, Buffer.alloc(body)]));
}

export function instruction(
  programIdIndex: number,
  accounts: number[],
  data: Uint8Array,
): RawInstruction {
  return { programIdIndex, accounts, data, stackHeight: null };
}

export function tokenBalance(
  accountIndex: number,
  mint: string,
  owner: string | null,
  amount: bigint,
  decimals = 6,
): RawTokenBalance {
  return { accountIndex, mint, owner, programId: TOKEN_PROGRAM, amount, decimals };
}

export function buildTransaction(overrides: Partial<RawTransaction> = {}): RawTransaction {
  return {
    signature: signature('sig'),
    slot: 1000,
    index: 0,
    isVote: false,
    err: null,
    fee: 5000n,
    computeUnits: null,
    recentBlockhash: address('blockhash'),
    versioned: false,
    accountKeys: [address('payer'), address('recipient'), SYSTEM_PROGRAM],
    loadedWritableAddresses: [],
    loadedReadonlyAddresses: [],
    numRequiredSignatures: 1,
    instructions: [],
    innerInstructions: [],
    logs: [],
    preBalances: [],
    postBalances: [],
    preTokenBalances: [],
    postTokenBalances: [],
    ...overrides,
  };
}
