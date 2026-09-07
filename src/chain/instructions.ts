import { readU32LE, readU64LE } from './bytes';
import { SYSTEM_PROGRAM, TOKEN_PROGRAMS } from './programs';

/**
 * The only two instruction formats this project decodes.
 *
 * Transfers are read from the instruction itself because a transfer is defined
 * by its instruction — who sent what to whom is in the arguments. Swaps are
 * not decoded here at all: they are inferred from balance movement, so no DEX's
 * instruction format ever needs to be understood.
 */

/** System instructions carry a little-endian u32 discriminant. */
const SYSTEM_TRANSFER = 2;
const SYSTEM_TRANSFER_WITH_SEED = 11;

/** SPL Token instructions carry a single leading byte. Token-2022 matches. */
const TOKEN_TRANSFER = 3;
const TOKEN_TRANSFER_CHECKED = 12;

interface DecodedTransfer {
  amount: bigint;
  /** Positions within the instruction's own account list. */
  sourceIndex: number;
  destinationIndex: number;
  /** Only TransferChecked names the mint; null means "look it up elsewhere". */
  mintIndex: number | null;
  decimals: number | null;
}

/**
 * Decodes a System program transfer. Returns null for any other instruction, a
 * payload too short to hold the amount, or a transfer missing an account it
 * needs.
 */
function decodeSystemTransfer(
  data: Uint8Array,
  accountCount: number,
): DecodedTransfer | null {
  const tag = readU32LE(data, 0);
  if (tag === null) return null;

  if (tag === SYSTEM_TRANSFER) {
    const amount = readU64LE(data, 4);
    // Accounts are [funding, recipient].
    if (amount === null || accountCount < 2) return null;

    return { amount, sourceIndex: 0, destinationIndex: 1, mintIndex: null, decimals: null };
  }

  if (tag === SYSTEM_TRANSFER_WITH_SEED) {
    const amount = readU64LE(data, 4);
    // Accounts are [funding, base, recipient]; the seed and owner that follow
    // the lamports in the payload are not needed to record the movement.
    if (amount === null || accountCount < 3) return null;

    return { amount, sourceIndex: 0, destinationIndex: 2, mintIndex: null, decimals: null };
  }

  return null;
}

/** Decodes an SPL Token or Token-2022 transfer; null for anything else. */
function decodeTokenTransfer(
  data: Uint8Array,
  accountCount: number,
): DecodedTransfer | null {
  if (data.length < 1) return null;

  if (data[0] === TOKEN_TRANSFER) {
    const amount = readU64LE(data, 1);
    // Accounts are [source, destination, authority].
    if (amount === null || accountCount < 3) return null;

    return { amount, sourceIndex: 0, destinationIndex: 1, mintIndex: null, decimals: null };
  }

  if (data[0] === TOKEN_TRANSFER_CHECKED) {
    const amount = readU64LE(data, 1);
    // Accounts are [source, mint, destination, authority], and the decimals
    // byte follows the amount.
    if (amount === null || data.length < 10 || accountCount < 4) return null;

    return { amount, sourceIndex: 0, destinationIndex: 2, mintIndex: 1, decimals: data[9] };
  }

  return null;
}

/** Dispatches on the owning program; null if that program moves no value. */
export function decodeTransfer(
  programId: string,
  data: Uint8Array,
  accountCount: number,
): DecodedTransfer | null {
  if (programId === SYSTEM_PROGRAM) return decodeSystemTransfer(data, accountCount);
  if (TOKEN_PROGRAMS.has(programId)) return decodeTokenTransfer(data, accountCount);

  return null;
}
