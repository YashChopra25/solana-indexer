import { toBase58, toBase64, toBytes } from '../chain/bytes';
import type {
  RawAccountUpdate,
  RawBlock,
  RawInnerInstructions,
  RawInstruction,
  RawTokenBalance,
  RawTransaction,
} from '../domain/types';

/**
 * LaserStream protobuf updates, turned into the plain objects in
 * `src/domain/types.ts`. This is the only file that knows the wire format;
 * replacing the data source means replacing this file and nothing else.
 */

/**
 * A decoded protobuf message. The generated bindings type every field as
 * optional and nullable, with several representations per numeric field, so
 * asserting a precise shape here would be fiction — each field below is
 * narrowed explicitly instead.
 */
export type ProtoMessage = Record<string, unknown>;

/** protobufjs decodes a uint64 as a Long object, a number, or a string. */
function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string') return value ? BigInt(value) : 0n;

  if (value && typeof value === 'object' && 'low' in (value as Record<string, unknown>)) {
    const { low, high, unsigned } = value as { low: number; high: number; unsigned?: boolean };
    const raw = (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);

    // A signed Long with its high bit set is a negative two's-complement value.
    return unsigned === false && high < 0 ? raw - (1n << 64n) : raw;
  }

  return 0n;
}

export function toNumber(value: unknown): number {
  return Number(toBigInt(value));
}

/** Instruction account indexes arrive as a packed byte array. */
function toAccountIndexes(value: unknown): number[] {
  return Array.from(toBytes(value));
}

function mapInstruction(raw: ProtoMessage): RawInstruction {
  return {
    programIdIndex: Number(raw.programIdIndex ?? 0),
    accounts: toAccountIndexes(raw.accounts),
    data: toBytes(raw.data),
    stackHeight:
      raw.stackHeight === null || raw.stackHeight === undefined ? null : Number(raw.stackHeight),
  };
}

function mapInnerInstructions(raw: unknown): RawInnerInstructions[] {
  if (!Array.isArray(raw)) return [];

  return (raw as ProtoMessage[]).map((group) => ({
    index: Number(group.index ?? 0),
    instructions: Array.isArray(group.instructions)
      ? (group.instructions as ProtoMessage[]).map(mapInstruction)
      : [],
  }));
}

function mapTokenBalances(raw: unknown): RawTokenBalance[] {
  if (!Array.isArray(raw)) return [];

  return (raw as ProtoMessage[])
    .map((balance) => {
      const amount = balance.uiTokenAmount as ProtoMessage | undefined;

      return {
        accountIndex: Number(balance.accountIndex ?? 0),
        mint: String(balance.mint ?? ''),
        owner: balance.owner ? String(balance.owner) : null,
        programId: balance.programId ? String(balance.programId) : null,
        // The raw amount is a u64 string; anything else means an empty account.
        amount: toBigInt(amount?.amount ?? '0'),
        decimals: Number(amount?.decimals ?? 0),
      };
    })
    .filter((balance) => balance.mint.length > 0);
}

/**
 * Converts a SubscribeUpdateTransaction. Returns null when the update is
 * missing the message body it cannot be read without.
 */
export function decodeTransaction(update: ProtoMessage): RawTransaction | null {
  const info = update?.transaction as ProtoMessage | undefined;
  const container = info?.transaction as ProtoMessage | undefined;
  const message = container?.message as ProtoMessage | undefined;

  if (!info || !message) return null;

  const meta = (info.meta ?? {}) as ProtoMessage;
  const header = (message.header ?? {}) as ProtoMessage;
  const err = meta.err as ProtoMessage | undefined;

  return {
    signature: toBase58(info.signature),
    slot: toNumber(update.slot),
    index: toNumber(info.index),
    isVote: Boolean(info.isVote),
    // A present `err` means the transaction failed; the payload is the
    // bincode-encoded TransactionError, kept verbatim for inspection.
    err: err ? toBase64(err.err ?? err) : null,
    fee: toBigInt(meta.fee),
    computeUnits:
      meta.computeUnitsConsumed === null || meta.computeUnitsConsumed === undefined
        ? null
        : toBigInt(meta.computeUnitsConsumed),
    recentBlockhash: toBase58(message.recentBlockhash),
    versioned: Boolean(message.versioned),
    accountKeys: ((message.accountKeys ?? []) as unknown[]).map(toBase58),
    loadedWritableAddresses: ((meta.loadedWritableAddresses ?? []) as unknown[]).map(toBase58),
    loadedReadonlyAddresses: ((meta.loadedReadonlyAddresses ?? []) as unknown[]).map(toBase58),
    numRequiredSignatures: Number(header.numRequiredSignatures ?? 0),
    instructions: ((message.instructions ?? []) as ProtoMessage[]).map(mapInstruction),
    innerInstructions: meta.innerInstructionsNone
      ? []
      : mapInnerInstructions(meta.innerInstructions),
    logs: meta.logMessagesNone ? [] : ((meta.logMessages ?? []) as unknown[]).map(String),
    preBalances: ((meta.preBalances ?? []) as unknown[]).map(toBigInt),
    postBalances: ((meta.postBalances ?? []) as unknown[]).map(toBigInt),
    preTokenBalances: mapTokenBalances(meta.preTokenBalances),
    postTokenBalances: mapTokenBalances(meta.postTokenBalances),
  };
}

export function decodeBlock(update: ProtoMessage): RawBlock {
  // block_time and block_height are wrapper messages, each holding one field.
  const blockTime = (update.blockTime as ProtoMessage | undefined)?.timestamp;
  const blockHeight = (update.blockHeight as ProtoMessage | undefined)?.blockHeight;

  return {
    slot: toNumber(update.slot),
    blockhash: String(update.blockhash ?? ''),
    parentSlot: toNumber(update.parentSlot),
    blockTime: blockTime === null || blockTime === undefined ? null : toNumber(blockTime),
    blockHeight: blockHeight === null || blockHeight === undefined ? null : toNumber(blockHeight),
    transactionCount: toNumber(update.executedTransactionCount),
  };
}

/**
 * Converts a SubscribeUpdateAccount. Returns null when the update carries no
 * account body, which is what a startup snapshot marker looks like.
 */
export function decodeAccountUpdate(update: ProtoMessage): RawAccountUpdate | null {
  const info = update?.account as ProtoMessage | undefined;
  if (!info) return null;

  const pubkey = toBase58(info.pubkey);
  if (!pubkey) return null;

  // `data` is the account's whole contents. Only its size is kept: the bytes
  // can be megabytes, they are meaningless without the owning program's layout,
  // and nothing downstream reads them.
  const data = toBytes(info.data);

  return {
    pubkey,
    slot: toNumber(update.slot),
    owner: toBase58(info.owner),
    lamports: toBigInt(info.lamports),
    executable: Boolean(info.executable),
    writeVersion: toBigInt(info.writeVersion),
    dataLength: data.length,
    txnSignature: info.txnSignature ? toBase58(info.txnSignature) : null,
  };
}
