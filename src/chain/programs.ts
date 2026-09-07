/**
 * Program ids this indexer recognises, and the little that is known about them.
 *
 * Nothing here decodes a program's instructions. Swaps are derived from balance
 * movement rather than from any program's instruction format (see
 * `src/extract/swaps.ts`), so this file only needs to answer two questions:
 * "is this program plumbing?" and "what should this program be called?".
 */

export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const MEMO_LEGACY_PROGRAM = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo';

export const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);

/**
 * Programs that move value around on behalf of other programs but never
 * constitute an interesting action on their own.
 *
 * This set is what stops a plain token transfer from being read as a swap: a
 * transaction that touches nothing else is doing bookkeeping, not trading, no
 * matter what its balance deltas look like once rent is paid.
 */
const INFRASTRUCTURE_PROGRAMS = new Set([
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  MEMO_PROGRAM,
  MEMO_LEGACY_PROGRAM,
]);

/**
 * Display names, and nothing more. A program missing from this map is indexed
 * exactly like one that is present — the label is for the console, so an
 * unknown program shows its id rather than disappearing.
 */
const LABELS = new Map<string, string>([
  ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', 'Jupiter v6'],
  ['JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', 'Jupiter v4'],
  ['675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', 'Raydium AMM v4'],
  ['CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', 'Raydium CLMM'],
  ['routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS', 'Raydium Route'],
  ['whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', 'Orca Whirlpool'],
  ['9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'Orca v2'],
  ['LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', 'Meteora DLMM'],
  ['Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', 'Meteora Pools'],
  ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'pump.fun'],
  ['pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', 'pump.fun AMM'],
  ['PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY', 'Phoenix'],
  ['srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX', 'OpenBook'],
  [SYSTEM_PROGRAM, 'System'],
  [TOKEN_PROGRAM, 'SPL Token'],
  [TOKEN_2022_PROGRAM, 'Token-2022'],
  [ASSOCIATED_TOKEN_PROGRAM, 'Associated Token'],
  [COMPUTE_BUDGET_PROGRAM, 'Compute Budget'],
  [MEMO_PROGRAM, 'Memo'],
  [MEMO_LEGACY_PROGRAM, 'Memo (legacy)'],
]);

export function programLabel(programId: string): string | null {
  return LABELS.get(programId) ?? null;
}

/** True for programs that are plumbing rather than an action in their own right. */
export function isInfrastructure(programId: string): boolean {
  return INFRASTRUCTURE_PROGRAMS.has(programId);
}
