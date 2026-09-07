import { toBase64 } from '../chain/bytes';
import type {
  IndexedInstruction,
  IndexedTransaction,
  RawTransaction,
  TokenInfo,
} from '../domain/types';
import { flattenAccountKeys, resolveAccounts, signersOf, walkInstructions } from './accounts';
import { extractEvents } from './events';
import { extractInvocations } from './logs';
import { extractSwaps } from './swaps';
import { extractTransfers } from './transfers';

/**
 * One raw transaction in, one fully indexed transaction out.
 *
 * Pure and synchronous: no database, no network, no clock. Every failure mode
 * is represented in the output rather than thrown, so a single malformed
 * transaction can never stall the slot behind it.
 *
 * The order below matters in one place only — invocations are parsed before
 * events, because a log event is attributed to whichever program was running
 * when the line was printed.
 */

/** Every instruction, flattened, with its accounts and program resolved. */
function extractInstructions(tx: RawTransaction, keys: string[]): IndexedInstruction[] {
  const instructions: IndexedInstruction[] = [];

  for (const { instruction, instructionIndex, innerIndex } of walkInstructions(tx)) {
    instructions.push({
      instructionIndex,
      innerIndex,
      programId: keys[instruction.programIdIndex] ?? `unknown:${instruction.programIdIndex}`,
      accounts: resolveAccounts(instruction.accounts, keys),
      data: toBase64(instruction.data),
      stackHeight: instruction.stackHeight,
    });
  }

  return instructions;
}

/** Programs invoked, deduplicated, outermost first. */
function extractProgramIds(instructions: IndexedInstruction[]): string[] {
  return [...new Set(instructions.map((instruction) => instruction.programId))];
}

/**
 * Mints seen in this transaction. The balance snapshots give decimals and the
 * owning token program; either snapshot may omit the program, so whichever
 * named it wins.
 */
function extractTokens(tx: RawTransaction): Map<string, TokenInfo> {
  const tokens = new Map<string, TokenInfo>();

  for (const balance of [...tx.preTokenBalances, ...tx.postTokenBalances]) {
    if (!balance.mint) continue;

    const known = tokens.get(balance.mint);
    tokens.set(balance.mint, {
      decimals: balance.decimals,
      programId: balance.programId ?? known?.programId ?? null,
    });
  }

  return tokens;
}

export function indexTransaction(tx: RawTransaction): IndexedTransaction {
  const keys = flattenAccountKeys(tx);
  const signers = signersOf(tx);

  const instructions = extractInstructions(tx, keys);
  const programIds = extractProgramIds(instructions);
  const invocations = extractInvocations(tx.logs);

  return {
    signature: tx.signature,
    slot: tx.slot,
    transactionIndex: tx.index,
    success: tx.err === null,
    err: tx.err,
    fee: tx.fee,
    computeUnits: tx.computeUnits,
    recentBlockhash: tx.recentBlockhash,
    versioned: tx.versioned,
    feePayer: signers[0] ?? null,
    signers,
    accounts: keys,
    programIds,
    logs: tx.logs,
    instructions,
    transfers: extractTransfers(tx, keys),
    swaps: extractSwaps(tx, keys, signers, programIds),
    events: extractEvents(tx, keys, invocations),
    invocations,
    tokens: extractTokens(tx),
  };
}
