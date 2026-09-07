import { programLabel } from '../chain/programs';
import { NO_SYMBOLS, type Symbols } from './symbols';
import { TOP_LEVEL } from '../domain/types';
import type {
  AccountUpdateRow,
  ActivityRow,
  EventRow,
  InstructionRow,
  InvocationRow,
  SwapRow,
  TransactionRow,
  TransferRow,
} from '../store/read';

/**
 * Database row to JSON.
 *
 * Column names are snake_case and belong to the schema; the API speaks
 * camelCase. Keeping the translation here means renaming a column does not
 * change the wire format.
 *
 * Every amount goes out as a string. Lamport and token amounts are unsigned
 * 64-bit and can exceed Number.MAX_SAFE_INTEGER, so turning one into a JSON
 * number would quietly round it.
 */

function isoOrNull(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

/** `inner_index` uses -1 for top-level instructions; the API exposes null. */
function innerIndex(value: number): number | null {
  return value === TOP_LEVEL ? null : value;
}

/** A program is always identified by id; the label is a convenience on top. */
function program(programId: string) {
  return { id: programId, label: programLabel(programId) };
}

/**
 * An amount and the asset it is denominated in.
 *
 * `symbol` is null far more often than not, and that is the honest answer
 * rather than a gap: an indexer that tracks System and SPL Token sees every
 * mint on the chain, and almost none of them are listed anywhere. The console
 * falls back to a shortened mint, so the field being null costs a reader
 * nothing but a name.
 */
function amount(
  mint: string,
  raw: string | number | null,
  decimals: number | null,
  symbols: Symbols,
) {
  return {
    mint,
    amount: String(raw),
    decimals,
    symbol: symbols.get(mint) ?? null,
  };
}

export function serializeTransfer(row: TransferRow, symbols: Symbols = NO_SYMBOLS) {
  return {
    signature: row.signature,
    slot: row.slot,
    blockTime: isoOrNull(row.block_time),
    instructionIndex: row.instruction_index,
    innerIndex: innerIndex(row.inner_index),
    kind: row.kind,
    source: row.source,
    destination: row.destination,
    sourceOwner: row.source_owner,
    destinationOwner: row.destination_owner,
    amount: String(row.amount),
    mint: row.mint,
    decimals: row.decimals,
    symbol: symbols.get(row.mint) ?? null,
    program: program(row.program_id),
  };
}

export function serializeSwap(row: SwapRow, symbols: Symbols = NO_SYMBOLS) {
  return {
    signature: row.signature,
    slot: row.slot,
    blockTime: isoOrNull(row.block_time),
    owner: row.owner,
    in: amount(row.in_mint, row.in_amount, row.in_decimals, symbols),
    out: amount(row.out_mint, row.out_amount, row.out_decimals, symbols),
    program: program(row.program_id),
    route: row.route_programs.map(program),
  };
}

export function serializeEvent(row: EventRow) {
  return {
    signature: row.signature,
    eventIndex: row.event_index,
    slot: row.slot,
    blockTime: isoOrNull(row.block_time),
    program: program(row.program_id),
    source: row.source,
    discriminator: row.discriminator,
    // Base64, discriminator included. Decoding it needs the program's IDL,
    // which this indexer deliberately does not hold.
    data: row.data,
  };
}

export function serializeInstruction(row: InstructionRow) {
  return {
    instructionIndex: row.instruction_index,
    innerIndex: innerIndex(row.inner_index),
    program: program(row.program_id),
    accounts: row.accounts,
    data: row.data,
    stackHeight: row.stack_height,
  };
}

export function serializeInvocation(row: InvocationRow) {
  return {
    invocationIndex: row.invocation_index,
    program: program(row.program_id),
    depth: row.depth,
    parentIndex: row.parent_index,
    success: row.success,
    computeUnits: row.compute_units,
    logs: row.logs,
  };
}

export function serializeTransaction(row: TransactionRow) {
  return {
    signature: row.signature,
    slot: row.slot,
    blockTime: isoOrNull(row.block_time),
    transactionIndex: row.transaction_index,
    success: row.success,
    err: row.err,
    fee: String(row.fee),
    computeUnits: row.compute_units === null ? null : String(row.compute_units),
    recentBlockhash: row.recent_blockhash,
    versioned: row.versioned,
    feePayer: row.fee_payer,
    signers: row.signers,
    accounts: row.accounts,
    programs: row.program_ids.map(program),
    logs: row.logs,
  };
}

/**
 * One row of a wallet's timeline. The three kinds share a shape so a client can
 * render the feed without switching on the kind first — `primary` is what
 * moved, and `counter` is the other side of a swap.
 */
export function serializeActivity(row: ActivityRow, symbols: Symbols = NO_SYMBOLS) {
  return {
    kind: row.kind,
    signature: row.signature,
    slot: row.slot,
    blockTime: isoOrNull(row.block_time),
    program: program(row.program_id),
    direction: row.direction,
    primary:
      row.primary_mint === null
        ? null
        : amount(row.primary_mint, row.primary_amount, row.primary_decimals, symbols),
    counter:
      row.counter_mint === null
        ? null
        : amount(row.counter_mint, row.counter_amount, row.counter_decimals, symbols),
    discriminator: row.discriminator,
  };
}

/** One write to a watched account, from the `accounts` subscription. */
export function serializeAccountUpdate(row: AccountUpdateRow) {
  return {
    pubkey: row.pubkey,
    slot: row.slot,
    writeVersion: String(row.write_version),
    owner: program(row.owner),
    lamports: String(row.lamports),
    executable: row.executable,
    dataLength: row.data_length,
    /** The transaction that caused the write, when the stream named one. */
    signature: row.txn_signature,
    observedAt: isoOrNull(row.observed_at),
  };
}
