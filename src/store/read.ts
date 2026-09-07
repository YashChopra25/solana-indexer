import { getPool } from './pool';
import type { Page } from '../server/http';

/**
 * Every SQL read the API makes.
 *
 * List queries ask for `limit + 1` rows so the route can tell whether another
 * page exists without a second COUNT.
 */

const TRANSACTION_COLUMNS = `
  signature, slot, block_time, transaction_index, success, err, fee, compute_units,
  recent_blockhash, versioned, fee_payer, signers, accounts, program_ids, logs
`;

const TRANSFER_COLUMNS = `
  signature, slot, block_time, instruction_index, inner_index, kind, source, destination,
  source_owner, destination_owner, amount, mint, decimals, program_id
`;

const SWAP_COLUMNS = `
  signature, owner, slot, block_time, in_mint, in_amount, in_decimals,
  out_mint, out_amount, out_decimals, program_id, route_programs
`;

const EVENT_COLUMNS = `
  signature, event_index, slot, block_time, program_id, source, discriminator, data
`;

export interface TransactionRow {
  signature: string;
  slot: number;
  block_time: Date | null;
  transaction_index: number;
  success: boolean;
  err: string | null;
  fee: number;
  compute_units: number | null;
  recent_blockhash: string | null;
  versioned: boolean;
  fee_payer: string | null;
  signers: string[];
  accounts: string[];
  program_ids: string[];
  logs: string[];
}

export interface TransferRow {
  signature: string;
  slot: number;
  block_time: Date | null;
  instruction_index: number;
  inner_index: number;
  kind: 'sol' | 'spl';
  source: string;
  destination: string;
  source_owner: string | null;
  destination_owner: string | null;
  /** NUMERIC comes back as a string, to preserve u64 precision. */
  amount: string;
  mint: string;
  decimals: number | null;
  program_id: string;
}

export interface SwapRow {
  signature: string;
  owner: string;
  slot: number;
  block_time: Date | null;
  in_mint: string;
  in_amount: string;
  in_decimals: number | null;
  out_mint: string;
  out_amount: string;
  out_decimals: number | null;
  program_id: string;
  route_programs: string[];
}

export interface EventRow {
  signature: string;
  event_index: number;
  slot: number;
  block_time: Date | null;
  program_id: string;
  source: 'log' | 'cpi';
  discriminator: string;
  data: string;
}

export interface InstructionRow {
  instruction_index: number;
  inner_index: number;
  program_id: string;
  accounts: string[];
  data: string;
  stack_height: number | null;
}

export interface InvocationRow {
  invocation_index: number;
  program_id: string;
  depth: number;
  parent_index: number | null;
  success: boolean;
  compute_units: number | null;
  logs: string[];
}

export interface ActivityRow {
  kind: 'transfer' | 'swap' | 'event';
  signature: string;
  slot: number;
  block_time: Date | null;
  program_id: string;
  primary_mint: string | null;
  primary_amount: string | null;
  primary_decimals: number | null;
  counter_mint: string | null;
  counter_amount: string | null;
  counter_decimals: number | null;
  discriminator: string | null;
  direction: 'in' | 'out' | null;
}

/* ------------------------------------------------------------------ */
/* Single records                                                      */
/* ------------------------------------------------------------------ */

export async function findTransaction(signature: string): Promise<TransactionRow | null> {
  const { rows } = await getPool().query<TransactionRow>(
    `SELECT ${TRANSACTION_COLUMNS} FROM transactions WHERE signature = $1`,
    [signature],
  );

  return rows[0] ?? null;
}

export async function findInstructions(signature: string): Promise<InstructionRow[]> {
  const { rows } = await getPool().query<InstructionRow>(
    `SELECT instruction_index, inner_index, program_id, accounts, data, stack_height
     FROM instructions WHERE signature = $1
     ORDER BY instruction_index, inner_index`,
    [signature],
  );

  return rows;
}

export async function findInvocations(signature: string): Promise<InvocationRow[]> {
  const { rows } = await getPool().query<InvocationRow>(
    `SELECT invocation_index, program_id, depth, parent_index, success, compute_units, logs
     FROM invocations WHERE signature = $1
     ORDER BY invocation_index`,
    [signature],
  );

  return rows;
}

export async function findTransfersOf(signature: string): Promise<TransferRow[]> {
  const { rows } = await getPool().query<TransferRow>(
    `SELECT ${TRANSFER_COLUMNS} FROM transfers WHERE signature = $1
     ORDER BY instruction_index, inner_index`,
    [signature],
  );

  return rows;
}

export async function findSwapsOf(signature: string): Promise<SwapRow[]> {
  const { rows } = await getPool().query<SwapRow>(
    `SELECT ${SWAP_COLUMNS} FROM swaps WHERE signature = $1 ORDER BY owner`,
    [signature],
  );

  return rows;
}

export async function findEventsOf(signature: string): Promise<EventRow[]> {
  const { rows } = await getPool().query<EventRow>(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE signature = $1 ORDER BY event_index`,
    [signature],
  );

  return rows;
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

interface TransferFilters {
  address?: string;
  mint?: string;
  kind?: 'sol' | 'spl';
}

/**
 * An address matches a transfer on either side, as the token account or as the
 * wallet that owns it — which is why there are four indexed columns to check.
 */
export async function findTransfers(
  filters: TransferFilters,
  page: Page,
): Promise<TransferRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.address) {
    params.push(filters.address);
    const p = `$${params.length}`;
    conditions.push(
      `(source = ${p} OR destination = ${p} OR source_owner = ${p} OR destination_owner = ${p})`,
    );
  }

  if (filters.mint) {
    params.push(filters.mint);
    conditions.push(`mint = $${params.length}`);
  }

  if (filters.kind) {
    params.push(filters.kind);
    conditions.push(`kind = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(page.limit + 1, page.offset);

  const { rows } = await getPool().query<TransferRow>(
    `SELECT ${TRANSFER_COLUMNS} FROM transfers
     ${where}
     ORDER BY slot DESC, signature, instruction_index, inner_index
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return rows;
}

interface SwapFilters {
  owner?: string;
  mint?: string;
  programId?: string;
}

/** A `mint` filter matches either side of the trade. */
export async function findSwaps(filters: SwapFilters, page: Page): Promise<SwapRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.owner) {
    params.push(filters.owner);
    conditions.push(`owner = $${params.length}`);
  }

  if (filters.mint) {
    params.push(filters.mint);
    const p = `$${params.length}`;
    conditions.push(`(in_mint = ${p} OR out_mint = ${p})`);
  }

  if (filters.programId) {
    params.push(filters.programId);
    const p = `$${params.length}`;
    // Either the program credited with the swap, or any venue it routed through.
    conditions.push(`(program_id = ${p} OR route_programs @> ARRAY[${p}]::TEXT[])`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(page.limit + 1, page.offset);

  const { rows } = await getPool().query<SwapRow>(
    `SELECT ${SWAP_COLUMNS} FROM swaps
     ${where}
     ORDER BY slot DESC, signature, owner
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return rows;
}

interface EventFilters {
  programId?: string;
  discriminator?: string;
  source?: 'log' | 'cpi';
}

export async function findEvents(filters: EventFilters, page: Page): Promise<EventRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.programId) {
    params.push(filters.programId);
    conditions.push(`program_id = $${params.length}`);
  }

  if (filters.discriminator) {
    params.push(filters.discriminator);
    conditions.push(`discriminator = $${params.length}`);
  }

  if (filters.source) {
    params.push(filters.source);
    conditions.push(`source = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(page.limit + 1, page.offset);

  const { rows } = await getPool().query<EventRow>(
    `SELECT ${EVENT_COLUMNS} FROM events
     ${where}
     ORDER BY slot DESC, signature, event_index
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return rows;
}

/**
 * A program's recent invocations, newest first.
 *
 * This is what makes a program with no Anchor events still worth a page: every
 * program leaves invocations behind, whether or not it emits anything.
 */
export async function findInvocationsByProgram(
  programId: string,
  page: Page,
): Promise<(InvocationRow & { signature: string; slot: number })[]> {
  const { rows } = await getPool().query<InvocationRow & { signature: string; slot: number }>(
    `SELECT signature, slot, invocation_index, program_id, depth, parent_index, success,
            compute_units, logs
     FROM invocations
     WHERE program_id = $1
     ORDER BY slot DESC, signature, invocation_index
     LIMIT $2 OFFSET $3`,
    [programId, page.limit + 1, page.offset],
  );

  return rows;
}

export interface AccountUpdateRow {
  pubkey: string;
  slot: number;
  write_version: string;
  owner: string;
  lamports: string;
  executable: boolean;
  data_length: number;
  txn_signature: string | null;
  observed_at: Date;
}

/** Recent writes to one account, newest first. */
export async function findAccountUpdates(
  pubkey: string,
  page: Page,
): Promise<AccountUpdateRow[]> {
  const { rows } = await getPool().query<AccountUpdateRow>(
    `SELECT pubkey, slot, write_version, owner, lamports, executable, data_length,
            txn_signature, observed_at
     FROM account_updates
     WHERE pubkey = $1
     ORDER BY slot DESC, write_version DESC
     LIMIT $2 OFFSET $3`,
    [pubkey, page.limit + 1, page.offset],
  );

  return rows;
}

export async function findTransactionsByAddress(
  address: string,
  page: Page,
): Promise<TransactionRow[]> {
  const { rows } = await getPool().query<TransactionRow>(
    `SELECT ${TRANSACTION_COLUMNS} FROM transactions
     WHERE accounts @> ARRAY[$1]::TEXT[]
     ORDER BY slot DESC, transaction_index DESC
     LIMIT $2 OFFSET $3`,
    [address, page.limit + 1, page.offset],
  );

  return rows;
}

/**
 * One wallet's timeline: transfers, swaps and events in slot order.
 *
 * Written as a UNION of three separately-filtered queries rather than as a view
 * over the three tables. Each branch below hits an index on the column it
 * filters — `transfers` has one per party column, `swaps` one on owner,
 * `transactions` a GIN index on signers. A view would have to filter on
 * computed columns like `COALESCE(source_owner, source)`, which no index
 * covers, turning every wallet lookup into a sequential scan of the transfers
 * table.
 *
 * Events have no wallet of their own, so they are attributed to the signers of
 * the transaction that produced them: "this wallet caused this program event".
 */
/**
 * The columns every activity branch must produce, in order.
 *
 * A UNION takes its column *names* from the first branch alone, so a branch
 * without aliases silently renames the whole result the moment it happens to be
 * first — which it is as soon as a filter drops the branches before it. Every
 * branch therefore aliases every column, and `activityBranches` is written so
 * they cannot drift apart unnoticed.
 */
export const ACTIVITY_COLUMNS = [
  'kind',
  'signature',
  'slot',
  'block_time',
  'program_id',
  'primary_mint',
  'primary_amount',
  'primary_decimals',
  'counter_mint',
  'counter_amount',
  'counter_decimals',
  'discriminator',
  'direction',
] as const;

/** Pairs each expression with the column name it must be returned under. */
function branch(expressions: string[], from: string): string {
  const projection = expressions
    .map((expression, i) => `${expression} AS ${ACTIVITY_COLUMNS[i]}`)
    .join(',\n             ');

  return `SELECT ${projection}\n      ${from}`;
}

/**
 * One SELECT per requested kind, each projecting `ACTIVITY_COLUMNS` exactly.
 *
 * Exported so a test can check the branches agree without needing a database:
 * the failure this guards against is invisible until a filter reorders them.
 */
export function activityBranches(
  kinds: ReadonlyArray<'transfer' | 'swap' | 'event'>,
): string[] {
  const branches: string[] = [];

  if (kinds.includes('transfer')) {
    branches.push(
      branch(
        [
          `'transfer'::TEXT`,
          't.signature',
          't.slot',
          't.block_time',
          't.program_id',
          't.mint',
          't.amount',
          't.decimals',
          'NULL::TEXT',
          'NULL::NUMERIC',
          'NULL::INTEGER',
          'NULL::TEXT',
          `CASE WHEN t.source = $1 OR t.source_owner = $1 THEN 'out' ELSE 'in' END`,
        ],
        `FROM transfers t
       WHERE t.source = $1 OR t.destination = $1 OR t.source_owner = $1 OR t.destination_owner = $1`,
      ),
    );
  }

  if (kinds.includes('swap')) {
    branches.push(
      branch(
        [
          `'swap'::TEXT`,
          's.signature',
          's.slot',
          's.block_time',
          's.program_id',
          's.in_mint',
          's.in_amount',
          's.in_decimals',
          's.out_mint',
          's.out_amount',
          's.out_decimals',
          'NULL::TEXT',
          'NULL::TEXT',
        ],
        `FROM swaps s
       WHERE s.owner = $1`,
      ),
    );
  }

  if (kinds.includes('event')) {
    branches.push(
      branch(
        [
          `'event'::TEXT`,
          'e.signature',
          'e.slot',
          'e.block_time',
          'e.program_id',
          'NULL::TEXT',
          'NULL::NUMERIC',
          'NULL::INTEGER',
          'NULL::TEXT',
          'NULL::NUMERIC',
          'NULL::INTEGER',
          'e.discriminator',
          'NULL::TEXT',
        ],
        `FROM events e
       JOIN transactions tx ON tx.signature = e.signature
       WHERE tx.signers @> ARRAY[$1]::TEXT[]`,
      ),
    );
  }

  return branches;
}

/**
 * One wallet's timeline: transfers, swaps and events in slot order.
 *
 * Written as a UNION of three separately-filtered queries rather than as a view
 * over the three tables. Each branch hits an index on the column it filters —
 * `transfers` has one per party column, `swaps` one on owner, `transactions` a
 * GIN index on signers. A view would have to filter on computed columns like
 * `COALESCE(source_owner, source)`, which no index covers, turning every wallet
 * lookup into a sequential scan of the transfers table.
 *
 * Events have no wallet of their own, so they are attributed to the signers of
 * the transaction that produced them: "this wallet caused this program event".
 */
export async function findActivity(
  address: string,
  kinds: ReadonlyArray<'transfer' | 'swap' | 'event'>,
  page: Page,
): Promise<ActivityRow[]> {
  const branches = activityBranches(kinds);
  if (branches.length === 0) return [];

  const { rows } = await getPool().query<ActivityRow>(
    `SELECT * FROM (${branches.join(' UNION ALL ')}) AS activity
     ORDER BY slot DESC, signature
     LIMIT $2 OFFSET $3`,
    [address, page.limit + 1, page.offset],
  );

  return rows;
}

/* ------------------------------------------------------------------ */
/* Aggregates                                                          */
/* ------------------------------------------------------------------ */

export async function findToken(mint: string) {
  const { rows } = await getPool().query(
    `SELECT t.mint, t.decimals, t.program_id, t.first_seen_slot, t.updated_at,
            COALESCE(x.transfer_count, 0) AS transfer_count,
            COALESCE(x.swap_count, 0)     AS swap_count,
            x.last_slot
     FROM tokens t
     LEFT JOIN LATERAL (
       SELECT (SELECT COUNT(*) FROM transfers WHERE mint = t.mint)                     AS transfer_count,
              (SELECT COUNT(*) FROM swaps WHERE in_mint = t.mint OR out_mint = t.mint) AS swap_count,
              (SELECT MAX(slot) FROM transfers WHERE mint = t.mint)                    AS last_slot
     ) x ON TRUE
     WHERE t.mint = $1`,
    [mint],
  );

  return rows[0] ?? null;
}

/** A program's footprint: how often it ran, and what it emitted. */
export async function findProgram(programId: string) {
  const { rows } = await getPool().query(
    `SELECT $1::TEXT AS program_id,
            (SELECT COUNT(*) FROM invocations WHERE program_id = $1)          AS invocation_count,
            (SELECT COUNT(*) FROM events WHERE program_id = $1)               AS event_count,
            (SELECT COUNT(*) FROM swaps WHERE program_id = $1)                AS swap_count,
            (SELECT MAX(slot) FROM invocations WHERE program_id = $1)         AS last_slot,
            (SELECT COUNT(DISTINCT discriminator) FROM events WHERE program_id = $1) AS event_types`,
    [programId],
  );

  return rows[0] ?? null;
}

/** The event types one program emits, most frequent first. */
export async function findProgramEventTypes(programId: string, limit: number) {
  const { rows } = await getPool().query(
    `SELECT discriminator, source, COUNT(*) AS count, MAX(slot) AS last_slot
     FROM events WHERE program_id = $1
     GROUP BY discriminator, source
     ORDER BY count DESC
     LIMIT $2`,
    [programId, limit],
  );

  return rows;
}

export async function readIndexerState() {
  const { rows } = await getPool().query(
    `SELECT last_processed_slot, last_block_time, slots_processed, transactions_count,
            transfers_count, swaps_count, events_count, updated_at
     FROM indexer_state WHERE id = 'default'`,
  );

  return rows[0] ?? null;
}

/** The row counts on the dashboard. */
export async function readTotals() {
  const { rows } = await getPool().query(
    `SELECT (SELECT COUNT(*) FROM slots)        AS slots,
            (SELECT COUNT(*) FROM transactions) AS transactions,
            (SELECT COUNT(*) FROM transfers)    AS transfers,
            (SELECT COUNT(*) FROM swaps)        AS swaps,
            (SELECT COUNT(*) FROM events)       AS events,
            (SELECT COUNT(*) FROM accounts)     AS accounts,
            (SELECT COUNT(*) FROM tokens)       AS tokens`,
  );

  return rows[0] ?? null;
}
