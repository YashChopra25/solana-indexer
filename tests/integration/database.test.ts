import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IndexedTransaction, RawBlock, SlotBatch } from '../../src/domain/types';

/**
 * The parts that only mean anything against a real Postgres: idempotent slot
 * writes, the checkpoint, late block times, and who owns a watch.
 *
 * Skipped unless TEST_DATABASE_URL points at a database these tests may wipe:
 *
 *   docker run -d --name indexer-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17-alpine
 *   TEST_DATABASE_URL=postgresql://postgres:test@localhost:55432/postgres npx vitest run
 */

const url = process.env.TEST_DATABASE_URL;

function tx(slot: number, signature: string): IndexedTransaction {
  return {
    signature,
    slot,
    transactionIndex: 0,
    success: true,
    err: null,
    fee: 5000n,
    computeUnits: null,
    recentBlockhash: 'hash',
    versioned: false,
    feePayer: 'payer',
    signers: ['payer'],
    accounts: ['payer'],
    programIds: [],
    logs: [],
    instructions: [],
    transfers: [],
    swaps: [],
    events: [],
    invocations: [],
    tokens: new Map(),
  };
}

function block(slot: number, blockTime: number | null = 1_700_000_000): RawBlock {
  return { slot, blockhash: `hash-${slot}`, parentSlot: slot - 1, blockTime, blockHeight: slot, transactionCount: 1 };
}

describe.skipIf(!url)('against Postgres', () => {
  // Imported after DATABASE_URL is set: the pool reads it when first loaded.
  let db: {
    pool: typeof import('../../src/store/pool');
    write: typeof import('../../src/store/write');
    watchlist: typeof import('../../src/store/watchlist');
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const pool = await import('../../src/store/pool');
    await pool.getPool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

    const { runMigrations } = await import('../../src/store/migrate');
    // Twice at once: the advisory lock must make the second wait, not fail.
    await Promise.all([runMigrations(), runMigrations()]);

    db = {
      pool,
      write: await import('../../src/store/write'),
      watchlist: await import('../../src/store/watchlist'),
    };
  });

  afterAll(async () => {
    await db?.pool.closePool();
  });

  const persist = (batches: SlotBatch[], checkpoint?: number) =>
    db.pool.withTransaction((client) => db.write.persistSlots(client, batches, checkpoint));

  const state = async () =>
    (
      await db.pool.getPool().query(
        `SELECT last_processed_slot, slots_processed, transactions_count FROM indexer_state WHERE id = 'default'`,
      )
    ).rows[0];

  it('writes a slot once, however often it is replayed', async () => {
    const batch = { slot: 100, block: block(100), transactions: [tx(100, 'sig-a')] };

    expect((await persist([batch])).transactions).toBe(1);
    expect((await persist([batch])).transactions).toBe(0);

    expect(await state()).toMatchObject({ last_processed_slot: 100, slots_processed: 1, transactions_count: 1 });
  });

  it('holds the checkpoint where the caller caps it, and never moves it back', async () => {
    await persist([{ slot: 105, block: block(105), transactions: [] }], 102);
    expect((await state()).last_processed_slot).toBe(102);

    await persist([{ slot: 106, block: block(106), transactions: [] }], 101);
    expect((await state()).last_processed_slot).toBe(102);
  });

  it('fills in block times that arrive after their slot was written', async () => {
    await persist([{ slot: 200, block: null, transactions: [tx(200, 'sig-late')] }]);
    await persist([{ slot: 200, block: block(200, 1_700_000_500), transactions: [] }]);

    const { rows } = await db.pool.getPool().query(
      `SELECT s.block_time AS slot_time, t.block_time AS tx_time
       FROM slots s JOIN transactions t ON t.slot = s.slot WHERE s.slot = 200`,
    );
    expect(rows[0].slot_time).toEqual(new Date(1_700_000_500 * 1000));
    expect(rows[0].tx_time).toEqual(new Date(1_700_000_500 * 1000));
  });

  it('gives a straggler the time its slot already has', async () => {
    await persist([{ slot: 300, block: block(300, 1_700_000_900), transactions: [tx(300, 'sig-first')] }]);
    // A transaction for slot 300 that turned up after the slot was written.
    await persist([{ slot: 300, block: null, transactions: [tx(300, 'sig-straggler')] }]);

    const { rows } = await db.pool.getPool().query(
      `SELECT block_time FROM transactions WHERE signature = 'sig-straggler'`,
    );
    expect(rows[0].block_time).toEqual(new Date(1_700_000_900 * 1000));
  });

  describe('watchlist ownership', () => {
    const A = { visitor: 'a'.repeat(22) };
    const B = { visitor: 'b'.repeat(22) };
    const caps = { total: 3, perVisitor: 2 };
    const wallet = (n: number) => `${n}`.padStart(32, '1');

    it('keeps a watch while anyone still wants it', async () => {
      await db.watchlist.addWatched(A, 'wallet', wallet(1), null, caps);
      const both = await db.watchlist.addWatched(B, 'wallet', wallet(1), null, caps);
      expect(both).toMatchObject({ watchers: 2, mine: true });

      expect(await db.watchlist.removeWatched(B, 'wallet', wallet(1))).toBe(true);
      const [left] = await db.watchlist.listWatched(A);
      expect(left).toMatchObject({ address: wallet(1), watchers: 1, mine: true });

      expect(await db.watchlist.removeWatched(B, 'wallet', wallet(1))).toBe(false);
      expect(await db.watchlist.removeWatched(A, 'wallet', wallet(1))).toBe(true);
      expect(await db.watchlist.listWatched(A)).toEqual([]);
    });

    it('enforces the per-browser and total caps, but not on the operator', async () => {
      await db.watchlist.addWatched(A, 'wallet', wallet(2), null, caps);
      await db.watchlist.addWatched(A, 'wallet', wallet(3), null, caps);
      await expect(db.watchlist.addWatched(A, 'wallet', wallet(4), null, caps)).rejects.toThrow(
        /up to 2/,
      );

      await db.watchlist.addWatched({ operator: true }, 'wallet', wallet(4), null, caps);
      await expect(db.watchlist.addWatched(B, 'wallet', wallet(5), null, caps)).rejects.toThrow(
        /full/,
      );
      // Joining an existing watch adds no row, so a full list still allows it.
      await db.watchlist.addWatched(B, 'wallet', wallet(2), null, caps);

      expect(await db.watchlist.removeWatched({ operator: true }, 'wallet', wallet(2))).toBe(true);
      expect((await db.watchlist.listWatched(null)).map((e) => e.address)).not.toContain(wallet(2));
    });

    it('frees places held by browsers that never came back, when the list is full', async () => {
      // The list now holds wallet(3) (A) and wallet(4) (operator); fill it.
      const C = { visitor: 'c'.repeat(22) };
      await db.watchlist.addWatched(C, 'wallet', wallet(6), null, caps);
      await expect(db.watchlist.addWatched(B, 'wallet', wallet(7), null, caps)).rejects.toThrow(/full/);

      await db.pool.getPool().query(
        `UPDATE watch_owners SET last_seen_at = NOW() - INTERVAL '31 days' WHERE visitor = $1`,
        [C.visitor],
      );

      await db.watchlist.addWatched(B, 'wallet', wallet(7), null, caps);
      const addresses = (await db.watchlist.listWatched(null)).map((e) => e.address);
      expect(addresses).toContain(wallet(7));
      expect(addresses).not.toContain(wallet(6));
      expect(addresses).toContain(wallet(4)); // the operator's never expire
    });
  });
});
