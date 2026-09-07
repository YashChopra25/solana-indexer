/**
 * Every shape this project works with, in the order data takes them on.
 *
 * `Raw*` is a transaction as it comes off the stream with the protobuf details
 * already stripped away. `Indexed*` is what the extractors make of it, and what
 * gets written to Postgres.
 */

/* ------------------------------------------------------------------ */
/* Off the wire                                                        */
/* ------------------------------------------------------------------ */

export interface RawInstruction {
  programIdIndex: number;
  /** Indexes into the transaction's flattened account list. */
  accounts: number[];
  data: Uint8Array;
  stackHeight: number | null;
}

export interface RawInnerInstructions {
  /** Index of the outer instruction that invoked these. */
  index: number;
  instructions: RawInstruction[];
}

export interface RawTokenBalance {
  accountIndex: number;
  mint: string;
  owner: string | null;
  programId: string | null;
  amount: bigint;
  decimals: number;
}

export interface RawTransaction {
  signature: string;
  slot: number;
  index: number;
  isVote: boolean;
  err: string | null;
  fee: bigint;
  computeUnits: bigint | null;
  recentBlockhash: string;
  versioned: boolean;
  /** Static keys from the message header. */
  accountKeys: string[];
  /** Resolved from address lookup tables, writable first. */
  loadedWritableAddresses: string[];
  loadedReadonlyAddresses: string[];
  numRequiredSignatures: number;
  instructions: RawInstruction[];
  innerInstructions: RawInnerInstructions[];
  logs: string[];
  /** Native lamport balances, indexed the same way as `accountKeys`. */
  preBalances: bigint[];
  postBalances: bigint[];
  preTokenBalances: RawTokenBalance[];
  postTokenBalances: RawTokenBalance[];
}

/**
 * One account's state at a slot, from an `accounts` subscription.
 *
 * A different source from transactions: this arrives because the account
 * itself changed, whoever changed it, so it reports a watched wallet or program
 * even when the transaction filter would not have carried it.
 */
export interface RawAccountUpdate {
  pubkey: string;
  slot: number;
  /** The program that owns the account — the token program for a token account. */
  owner: string;
  lamports: bigint;
  executable: boolean;
  /** Monotonic per account, so it orders two writes in the same slot. */
  writeVersion: bigint;
  dataLength: number;
  /** The transaction that caused the write, when there was one. */
  txnSignature: string | null;
}

export interface RawBlock {
  slot: number;
  blockhash: string;
  parentSlot: number;
  blockTime: number | null;
  blockHeight: number | null;
  transactionCount: number;
}

/* ------------------------------------------------------------------ */
/* What the extractors produce                                         */
/* ------------------------------------------------------------------ */

/**
 * Where something happened inside a transaction. `innerIndex` is null for a
 * top-level instruction; the database stores -1 there because the column is
 * part of a primary key and cannot be null.
 */
export interface Position {
  instructionIndex: number;
  innerIndex: number | null;
}

export interface IndexedInstruction extends Position {
  programId: string;
  accounts: string[];
  /** Base64. Kept verbatim so an instruction can be decoded later. */
  data: string;
  stackHeight: number | null;
}

export type TransferKind = 'sol' | 'spl';

export interface IndexedTransfer extends Position {
  kind: TransferKind;
  source: string;
  destination: string;
  /** Token account owners for SPL; null for native SOL, where they are equal. */
  sourceOwner: string | null;
  destinationOwner: string | null;
  amount: bigint;
  mint: string;
  decimals: number | null;
  programId: string;
}

/**
 * A swap, derived from what an owner's balances actually did rather than from
 * any program's instruction format.
 *
 * One row per owner per transaction: the owner gave `inAmount` of `inMint` and
 * received `outAmount` of `outMint`. `programId` is the program credited with
 * it, and `routePrograms` is every non-infrastructure program the transaction
 * touched, in invocation order.
 */
export interface IndexedSwap {
  owner: string;
  inMint: string;
  inAmount: bigint;
  inDecimals: number | null;
  outMint: string;
  outAmount: bigint;
  outDecimals: number | null;
  programId: string;
  routePrograms: string[];
}

export type EventSource = 'log' | 'cpi';

/**
 * An Anchor event. Without the program's IDL the payload cannot be given field
 * names, so the discriminator and the raw bytes are stored as they are — which
 * is still enough to count, filter and correlate events per program.
 */
export interface IndexedEvent {
  eventIndex: number;
  programId: string;
  source: EventSource;
  /** First 8 bytes of the payload, hex. Identifies the event type. */
  discriminator: string;
  /** The whole payload, base64, discriminator included. */
  data: string;
}

/** One `Program X invoke` … `Program X success` span, with the logs inside it. */
export interface IndexedInvocation {
  invocationIndex: number;
  programId: string;
  /** 1 for a top-level invocation, deeper for a CPI. */
  depth: number;
  /** Index of the invocation that made this call; null at the top level. */
  parentIndex: number | null;
  success: boolean;
  computeUnits: number | null;
  logs: string[];
}

export interface IndexedTransaction {
  signature: string;
  slot: number;
  transactionIndex: number;
  success: boolean;
  err: string | null;
  fee: bigint;
  computeUnits: bigint | null;
  recentBlockhash: string;
  versioned: boolean;
  feePayer: string | null;
  signers: string[];
  accounts: string[];
  /** Every program the transaction invoked, deduplicated, in first-seen order. */
  programIds: string[];
  logs: string[];
  instructions: IndexedInstruction[];
  transfers: IndexedTransfer[];
  swaps: IndexedSwap[];
  events: IndexedEvent[];
  invocations: IndexedInvocation[];
  /** Mints seen in this transaction, with whatever was learned about them. */
  tokens: Map<string, TokenInfo>;
}

export interface TokenInfo {
  decimals: number | null;
  programId: string | null;
}

export interface SlotBatch {
  slot: number;
  block: RawBlock | null;
  transactions: IndexedTransaction[];
}

/* ------------------------------------------------------------------ */
/* Native SOL                                                          */
/* ------------------------------------------------------------------ */

/**
 * Native SOL has no mint account, so it is recorded under a sentinel that lets
 * `transfers` and `swaps` stay single tables.
 *
 * This is deliberately *not* the wrapped-SOL mint below. Wrapping is a real
 * movement between two different things, and collapsing them would turn every
 * wrap into a swap of an asset for itself.
 */
export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111111';
export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
export const SOL_DECIMALS = 9;

/** Sentinel stored in `inner_index` for a top-level instruction. */
export const TOP_LEVEL = -1;
