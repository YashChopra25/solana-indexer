import { decodeTransfer } from '../chain/instructions';
import { SYSTEM_PROGRAM, TOKEN_PROGRAMS } from '../chain/programs';
import {
  NATIVE_SOL_MINT,
  SOL_DECIMALS,
  type IndexedTransfer,
  type RawTransaction,
} from '../domain/types';
import { accountAt, walkInstructions } from './accounts';

/**
 * Transfers, decoded from the instructions that performed them.
 *
 * Balance deltas would only show the net movement per account, so a transaction
 * that moves the same token three times would look like one. Decoding the
 * instructions gives three rows, including the ones invoked through CPI.
 */

interface TokenAccount {
  mint: string;
  owner: string | null;
  decimals: number;
}

/**
 * Token balance snapshots identify each token account by its index in the
 * flattened account list — the same index space instruction accounts use.
 *
 * Post-balances are applied last and therefore win: an account created during
 * the transaction appears only there.
 */
function tokenAccountsByIndex(tx: RawTransaction): Map<number, TokenAccount> {
  const accounts = new Map<number, TokenAccount>();

  for (const balance of [...tx.preTokenBalances, ...tx.postTokenBalances]) {
    if (!balance.mint) continue;

    accounts.set(balance.accountIndex, {
      mint: balance.mint,
      owner: balance.owner || null,
      decimals: balance.decimals,
    });
  }

  return accounts;
}

/**
 * Every SOL and SPL token transfer in a transaction, top-level and CPI alike.
 *
 * A failed transaction produces none: its instructions were rolled back on
 * chain, so recording them would report movement that never happened. The
 * transaction itself is still indexed, with `success = false`.
 */
export function extractTransfers(tx: RawTransaction, keys: string[]): IndexedTransfer[] {
  if (tx.err !== null) return [];

  const tokenAccounts = tokenAccountsByIndex(tx);
  const transfers: IndexedTransfer[] = [];

  for (const { instruction, instructionIndex, innerIndex } of walkInstructions(tx)) {
    const programId = keys[instruction.programIdIndex];
    if (!programId) continue;

    const accounts = instruction.accounts;
    const decoded = decodeTransfer(programId, instruction.data, accounts.length);
    if (!decoded) continue;

    const source = accountAt(accounts, decoded.sourceIndex, keys);
    const destination = accountAt(accounts, decoded.destinationIndex, keys);
    if (!source || !destination) continue;

    if (programId === SYSTEM_PROGRAM) {
      transfers.push({
        instructionIndex,
        innerIndex,
        kind: 'sol',
        source,
        destination,
        // Native SOL is held by the address itself, so there is no separate
        // owner to record.
        sourceOwner: null,
        destinationOwner: null,
        amount: decoded.amount,
        mint: NATIVE_SOL_MINT,
        decimals: SOL_DECIMALS,
        programId,
      });
      continue;
    }

    if (!TOKEN_PROGRAMS.has(programId)) continue;

    const from = tokenAccounts.get(accounts[decoded.sourceIndex]);
    const to = tokenAccounts.get(accounts[decoded.destinationIndex]);

    // TransferChecked names the mint outright. Plain Transfer does not, so it
    // is recovered from either side's balance snapshot; with neither, the
    // transfer is skipped rather than stored under a guess.
    const mint =
      (decoded.mintIndex !== null ? accountAt(accounts, decoded.mintIndex, keys) : null) ??
      from?.mint ??
      to?.mint;

    if (!mint) continue;

    transfers.push({
      instructionIndex,
      innerIndex,
      kind: 'spl',
      source,
      destination,
      sourceOwner: from?.owner ?? null,
      destinationOwner: to?.owner ?? null,
      amount: decoded.amount,
      mint,
      decimals: decoded.decimals ?? from?.decimals ?? to?.decimals ?? null,
      programId,
    });
  }

  return transfers;
}
