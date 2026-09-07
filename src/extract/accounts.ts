import type { Position, RawInstruction, RawTransaction } from '../domain/types';

/**
 * Turning a transaction's index-based wire format into addresses.
 *
 * Every extractor starts here, because on the wire an instruction refers to its
 * accounts by position in a list that has to be rebuilt first.
 */

/**
 * The runtime addresses accounts through one flat list: the static message
 * keys, then writable addresses loaded from lookup tables, then readonly ones.
 * Instruction account indexes point into *that* list, in that order.
 */
export function flattenAccountKeys(tx: RawTransaction): string[] {
  return [...tx.accountKeys, ...tx.loadedWritableAddresses, ...tx.loadedReadonlyAddresses];
}

/**
 * The first `numRequiredSignatures` static keys are the signers, in order, and
 * the first of those is the fee payer.
 */
export function signersOf(tx: RawTransaction): string[] {
  return tx.accountKeys.slice(0, Math.max(0, tx.numRequiredSignatures));
}

interface Walked extends Position {
  instruction: RawInstruction;
}

/**
 * Every instruction in execution order: each top-level instruction followed by
 * the inner instructions it invoked.
 *
 * Inner instructions reported against an outer index that does not exist are
 * still yielded. That only happens when a message was truncated upstream, and
 * dropping them would lose data silently.
 */
export function* walkInstructions(tx: RawTransaction): Generator<Walked> {
  const innerByIndex = new Map(tx.innerInstructions.map((group) => [group.index, group.instructions]));

  for (let i = 0; i < tx.instructions.length; i++) {
    yield { instruction: tx.instructions[i], instructionIndex: i, innerIndex: null };

    const inner = innerByIndex.get(i) ?? [];
    for (let j = 0; j < inner.length; j++) {
      yield { instruction: inner[j], instructionIndex: i, innerIndex: j };
    }
  }

  for (const group of tx.innerInstructions) {
    if (group.index < tx.instructions.length) continue;

    for (let j = 0; j < group.instructions.length; j++) {
      yield { instruction: group.instructions[j], instructionIndex: group.index, innerIndex: j };
    }
  }
}

/**
 * An index past the end of the key list means the account list was truncated.
 * The slot is marked rather than dropped, so the instruction survives with a
 * visible hole instead of a plausible-looking wrong address.
 */
export function resolveAccounts(indexes: number[], keys: string[]): string[] {
  return indexes.map((index) => keys[index] ?? `unknown:${index}`);
}

/** One account of one instruction, or null when the position does not exist. */
export function accountAt(
  indexes: number[],
  position: number,
  keys: string[],
): string | null {
  const index = indexes[position];
  if (index === undefined) return null;

  return keys[index] ?? null;
}
