import {
  TOP_LEVEL,
  type IndexedTransaction,
  type RawAccountUpdate,
  type SlotBatch,
  type TokenInfo,
} from '../domain/types';
import type { PoolClient } from './pool';

/**
 * Everything the worker writes.
 *
 * One rule governs this whole file: writing the same slot twice must leave the
 * database exactly as the first write left it. The stream replays after a
 * reconnect and a restart re-reads the slot it died on, so a double write is
 * normal operation rather than an edge case. Every table has a natural primary
 * key, and every insert ends in ON CONFLICT DO NOTHING.
 */

interface WriteCounts {
  transactions: number;
  transfers: number;
  swaps: number;
  events: number;
}

/**
 * Inserts many rows in one statement.
 *
 * Postgres allows 65535 bind parameters per query, so rows are chunked to stay
 * under that. The return is how many rows were *new*, which is what keeps the
 * running totals honest when a slot is replayed.
 */
async function insertMany(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][],
  conflictKey: string,
): Promise<number> {
  if (rows.length === 0) return 0;

  const perChunk = Math.floor(60_000 / columns.length);
  let inserted = 0;

  for (let start = 0; start < rows.length; start += perChunk) {
    const chunk = rows.slice(start, start + perChunk);

    // ($1, $2, $3), ($4, $5, $6), ...
    const placeholders = chunk
      .map(
        (_, row) =>
          `(${columns.map((__, col) => `$${row * columns.length + col + 1}`).join(', ')})`,
      )
      .join(', ');

    const { rowCount } = await client.query(
      `INSERT INTO ${table} (${columns.join(', ')})
       VALUES ${placeholders}
       ON CONFLICT (${conflictKey}) DO NOTHING`,
      chunk.flat(),
    );

    inserted += rowCount ?? 0;
  }

  return inserted;
}

function toTimestamp(blockTime: number | null | undefined): Date | null {
  return blockTime === null || blockTime === undefined ? null : new Date(blockTime * 1000);
}

/* ------------------------------------------------------------------ */
/* Row builders — one per table, each pure                             */
/* ------------------------------------------------------------------ */

function slotRow(batch: SlotBatch): unknown[] {
  return [
    batch.slot,
    batch.block?.blockhash || null,
    batch.block?.parentSlot ?? null,
    toTimestamp(batch.block?.blockTime),
    batch.block?.blockHeight ?? null,
    batch.block?.transactionCount ?? 0,
    batch.transactions.length,
  ];
}

function transactionRows(transactions: IndexedTransaction[], blockTime: Date | null): unknown[][] {
  return transactions.map((tx) => [
    tx.signature,
    tx.slot,
    blockTime,
    tx.transactionIndex,
    tx.success,
    tx.err,
    tx.fee.toString(),
    tx.computeUnits?.toString() ?? null,
    tx.recentBlockhash,
    tx.versioned,
    tx.feePayer,
    tx.signers,
    tx.accounts,
    tx.programIds,
    tx.logs,
  ]);
}

function instructionRows(transactions: IndexedTransaction[]): unknown[][] {
  return transactions.flatMap((tx) =>
    tx.instructions.map((ix) => [
      tx.signature,
      ix.instructionIndex,
      ix.innerIndex ?? TOP_LEVEL,
      tx.slot,
      ix.programId,
      ix.accounts,
      ix.data,
      ix.stackHeight,
    ]),
  );
}

function transferRows(transactions: IndexedTransaction[], blockTime: Date | null): unknown[][] {
  return transactions.flatMap((tx) =>
    tx.transfers.map((transfer) => [
      tx.signature,
      transfer.instructionIndex,
      transfer.innerIndex ?? TOP_LEVEL,
      tx.slot,
      blockTime,
      transfer.kind,
      transfer.source,
      transfer.destination,
      transfer.sourceOwner,
      transfer.destinationOwner,
      transfer.amount.toString(),
      transfer.mint,
      transfer.decimals,
      transfer.programId,
    ]),
  );
}

function swapRows(transactions: IndexedTransaction[], blockTime: Date | null): unknown[][] {
  return transactions.flatMap((tx) =>
    tx.swaps.map((swap) => [
      tx.signature,
      swap.owner,
      tx.slot,
      blockTime,
      swap.inMint,
      swap.inAmount.toString(),
      swap.inDecimals,
      swap.outMint,
      swap.outAmount.toString(),
      swap.outDecimals,
      swap.programId,
      swap.routePrograms,
    ]),
  );
}

function eventRows(transactions: IndexedTransaction[], blockTime: Date | null): unknown[][] {
  return transactions.flatMap((tx) =>
    tx.events.map((event) => [
      tx.signature,
      event.eventIndex,
      tx.slot,
      blockTime,
      event.programId,
      event.source,
      event.discriminator,
      event.data,
    ]),
  );
}

function invocationRows(transactions: IndexedTransaction[]): unknown[][] {
  return transactions.flatMap((tx) =>
    tx.invocations.map((invocation) => [
      tx.signature,
      invocation.invocationIndex,
      tx.slot,
      invocation.programId,
      invocation.depth,
      invocation.parentIndex,
      invocation.success,
      invocation.computeUnits,
      invocation.logs,
    ]),
  );
}

/* ------------------------------------------------------------------ */
/* Upserts — the two tables that accumulate rather than append         */
/* ------------------------------------------------------------------ */

/**
 * Mints seen in this chunk. Unlike everything else this does update on
 * conflict: a later transaction may carry a decimals or program id that the
 * first sighting of the mint did not.
 */
async function upsertTokens(client: PoolClient, batches: SlotBatch[]): Promise<void> {
  const byMint = new Map<string, TokenInfo & { slot: number }>();

  const merge = (mint: string, info: TokenInfo, slot: number) => {
    const known = byMint.get(mint);
    byMint.set(mint, {
      decimals: info.decimals ?? known?.decimals ?? null,
      programId: info.programId ?? known?.programId ?? null,
      // The earliest slot this chunk saw the mint in.
      slot: Math.min(known?.slot ?? slot, slot),
    });
  };

  for (const batch of batches) {
    for (const tx of batch.transactions) {
      for (const [mint, info] of tx.tokens) merge(mint, info, tx.slot);

      // A transfer names the program that moved the token, which the balance
      // snapshots may not -- and for native SOL it is the only source of either.
      for (const transfer of tx.transfers) {
        merge(transfer.mint, { decimals: transfer.decimals, programId: transfer.programId }, tx.slot);
      }
    }
  }

  for (const [mint, info] of byMint) {
    await client.query(
      `INSERT INTO tokens (mint, decimals, program_id, first_seen_slot)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (mint) DO UPDATE SET
         decimals        = COALESCE(EXCLUDED.decimals, tokens.decimals),
         program_id      = COALESCE(EXCLUDED.program_id, tokens.program_id),
         first_seen_slot = LEAST(tokens.first_seen_slot, EXCLUDED.first_seen_slot),
         updated_at      = NOW()`,
      [mint, info.decimals, info.programId, info.slot],
    );
  }
}

/**
 * Every address this chunk touched, so a wallet lookup has something to find.
 *
 * Each address carries the slot it was actually seen in rather than the chunk's
 * first slot -- with up to fifty slots in a chunk, using one slot for all of
 * them would leave `last_seen_slot` short by the width of the chunk.
 */
async function upsertAccounts(client: PoolClient, batches: SlotBatch[]): Promise<void> {
  const slotByAddress = new Map<string, number>();

  for (const batch of batches) {
    for (const tx of batch.transactions) {
      for (const address of tx.accounts) {
        const known = slotByAddress.get(address);
        if (known === undefined || tx.slot > known) slotByAddress.set(address, tx.slot);
      }
    }
  }

  if (slotByAddress.size === 0) return;

  const rows = [...slotByAddress].map(([address, slot]) => [address, slot, slot]);
  const perChunk = 20_000;

  for (let start = 0; start < rows.length; start += perChunk) {
    const chunk = rows.slice(start, start + perChunk);
    const placeholders = chunk
      .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
      .join(', ');

    await client.query(
      `INSERT INTO accounts (address, first_seen_slot, last_seen_slot)
       VALUES ${placeholders}
       ON CONFLICT (address) DO UPDATE SET
         first_seen_slot = LEAST(accounts.first_seen_slot, EXCLUDED.first_seen_slot),
         last_seen_slot  = GREATEST(accounts.last_seen_slot, EXCLUDED.last_seen_slot)`,
      chunk.flat(),
    );
  }
}

/**
 * Moves the checkpoint forward.
 *
 * This is the statement that makes a restart safe: it runs in the same
 * transaction as the rows above, so the checkpoint can never point past data
 * that was not committed.
 *
 * GREATEST stops an out-of-order flush from moving it backwards, and
 * `slots_processed` counts only slots ahead of where the checkpoint already
 * was -- so replaying an indexed slot leaves every number unchanged.
 */
async function advanceCheckpoint(
  client: PoolClient,
  slots: number[],
  blockTime: Date | null,
  counts: WriteCounts,
): Promise<void> {
  await client.query(
    `UPDATE indexer_state
     SET last_processed_slot = GREATEST(last_processed_slot, $1),
         last_block_time     = COALESCE($2, last_block_time),
         slots_processed     = slots_processed + (
           SELECT count(*) FROM unnest($3::BIGINT[]) AS s WHERE s > last_processed_slot
         ),
         transactions_count  = transactions_count + $4,
         transfers_count     = transfers_count + $5,
         swaps_count         = swaps_count + $6,
         events_count        = events_count + $7,
         updated_at          = NOW()
     WHERE id = 'default'`,
    [
      Math.max(...slots),
      blockTime,
      slots,
      counts.transactions,
      counts.transfers,
      counts.swaps,
      counts.events,
    ],
  );
}

/**
 * Writes one or more slots: their slot rows, transactions, instructions,
 * transfers, swaps, events, invocations, the accounts and tokens they mention,
 * and the checkpoint.
 *
 * The caller wraps this in a single Postgres transaction, so a crash halfway
 * through rolls all of it back and those slots are simply indexed again.
 *
 * Passing several slots at once is what lets the worker catch up after a
 * reconnect: these statements cost about the same for fifty slots as for one --
 * it is the round trips that hurt -- so a backlog drains at roughly the chunk
 * size times the speed, and the buffer holding it empties instead of growing.
 */
export async function persistSlots(
  client: PoolClient,
  batches: SlotBatch[],
): Promise<WriteCounts> {
  const empty: WriteCounts = { transactions: 0, transfers: 0, swaps: 0, events: 0 };
  if (batches.length === 0) return empty;

  await insertMany(
    client,
    'slots',
    [
      'slot',
      'blockhash',
      'parent_slot',
      'block_time',
      'block_height',
      'transaction_count',
      'indexed_count',
    ],
    batches.map(slotRow),
    'slot',
  );

  // block_time belongs to the slot, so rows are built per slot and only then
  // concatenated into one statement per table.
  const timeOf = (batch: SlotBatch) => toTimestamp(batch.block?.blockTime);
  const all = batches.flatMap((batch) => batch.transactions);

  const transactions = await insertMany(
    client,
    'transactions',
    ['signature', 'slot', 'block_time', 'transaction_index', 'success', 'err', 'fee',
     'compute_units', 'recent_blockhash', 'versioned', 'fee_payer', 'signers', 'accounts',
     'program_ids', 'logs'],
    batches.flatMap((b) => transactionRows(b.transactions, timeOf(b))),
    'signature',
  );

  await insertMany(
    client,
    'instructions',
    ['signature', 'instruction_index', 'inner_index', 'slot', 'program_id', 'accounts', 'data',
     'stack_height'],
    instructionRows(all),
    'signature, instruction_index, inner_index',
  );

  const transfers = await insertMany(
    client,
    'transfers',
    ['signature', 'instruction_index', 'inner_index', 'slot', 'block_time', 'kind', 'source',
     'destination', 'source_owner', 'destination_owner', 'amount', 'mint', 'decimals',
     'program_id'],
    batches.flatMap((b) => transferRows(b.transactions, timeOf(b))),
    'signature, instruction_index, inner_index',
  );

  const swaps = await insertMany(
    client,
    'swaps',
    ['signature', 'owner', 'slot', 'block_time', 'in_mint', 'in_amount', 'in_decimals',
     'out_mint', 'out_amount', 'out_decimals', 'program_id', 'route_programs'],
    batches.flatMap((b) => swapRows(b.transactions, timeOf(b))),
    'signature, owner',
  );

  const events = await insertMany(
    client,
    'events',
    ['signature', 'event_index', 'slot', 'block_time', 'program_id', 'source', 'discriminator',
     'data'],
    batches.flatMap((b) => eventRows(b.transactions, timeOf(b))),
    'signature, event_index',
  );

  await insertMany(
    client,
    'invocations',
    ['signature', 'invocation_index', 'slot', 'program_id', 'depth', 'parent_index', 'success',
     'compute_units', 'logs'],
    invocationRows(all),
    'signature, invocation_index',
  );

  await upsertTokens(client, batches);
  await upsertAccounts(client, batches);

  const counts: WriteCounts = { transactions, transfers, swaps, events };
  const newest = batches[batches.length - 1];

  await advanceCheckpoint(
    client,
    batches.map((b) => b.slot),
    timeOf(newest),
    counts,
  );

  return counts;
}

interface Checkpoint {
  lastProcessedSlot: number;
}

/** The one row in `indexer_state`: how far the worker has got. */
export async function readCheckpoint(client: {
  query: PoolClient['query'];
}): Promise<Checkpoint | null> {
  const { rows } = await client.query(
    `SELECT last_processed_slot FROM indexer_state WHERE id = 'default'`,
  );

  if (!rows[0]) return null;

  return { lastProcessedSlot: Number(rows[0].last_processed_slot) };
}

/**
 * Account writes for watched addresses.
 *
 * Written on their own rather than inside a slot commit: they arrive from a
 * different filter, they are not tied to any transaction the indexer holds, and
 * `(pubkey, slot, write_version)` already makes a replay harmless. Folding them
 * into the slot batch would mean holding them until a slot happened to close.
 */
export async function persistAccountUpdates(
  client: PoolClient,
  updates: RawAccountUpdate[],
): Promise<number> {
  return insertMany(
    client,
    'account_updates',
    ['pubkey', 'slot', 'write_version', 'owner', 'lamports', 'executable', 'data_length',
     'txn_signature'],
    updates.map((update) => [
      update.pubkey,
      update.slot,
      update.writeVersion.toString(),
      update.owner,
      update.lamports.toString(),
      update.executable,
      update.dataLength,
      update.txnSignature,
    ]),
    'pubkey, slot, write_version',
  );
}
