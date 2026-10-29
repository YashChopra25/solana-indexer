import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndexedTransaction, RawBlock, SlotBatch } from '../../src/domain/types';

/**
 * The commit loop, with Postgres replaced by a stub: which slots get written,
 * where the checkpoint goes, and what happens when a write fails.
 */

const persisted: { slots: number[]; checkpoint: number }[] = [];
let failNext = 0;

vi.mock('../../src/store/pool', () => ({
  getPool: () => ({ query: async () => ({ rows: [] }) }),
  withTransaction: async (fn: (client: unknown) => unknown) => fn({}),
}));

vi.mock('../../src/store/write', () => ({
  readCheckpoint: async () => null,
  persistAccountUpdates: async () => 0,
  persistSlots: async (_client: unknown, batches: SlotBatch[], checkpoint: number) => {
    if (failNext > 0) {
      failNext--;
      throw new Error('database unavailable');
    }
    persisted.push({ slots: batches.map((b) => b.slot), checkpoint });
    return { transactions: 0, transfers: 0, swaps: 0, events: 0 };
  },
}));

const { Indexer } = await import('../../src/core/indexer');

function tx(slot: number, signature: string): IndexedTransaction {
  return {
    signature, slot, transactionIndex: 0, success: true, err: null, fee: 0n, computeUnits: null,
    recentBlockhash: '', versioned: false, feePayer: null, signers: [], accounts: [], programIds: [],
    logs: [], instructions: [], transfers: [], swaps: [], events: [], invocations: [], tokens: new Map(),
  };
}

function block(slot: number): RawBlock {
  return { slot, blockhash: `h${slot}`, parentSlot: slot - 1, blockTime: 1, blockHeight: slot, transactionCount: 1 };
}

/** The private parts under test, reached the way the stream callbacks reach them. */
type Internals = {
  window: { add(tx: IndexedTransaction): void; addBlock(b: RawBlock): void; size: number };
  commitReady(): Promise<void>;
  retryAt: number;
  failed: string | null;
};

describe('Indexer commits', () => {
  let ix: Internals;

  beforeEach(() => {
    persisted.length = 0;
    failNext = 0;
    ix = new Indexer() as unknown as Internals;
  });

  it('keeps the checkpoint below a slot still waiting for its block', async () => {
    ix.window.add(tx(100, 'a'));
    ix.window.add(tx(101, 'b'));
    ix.window.addBlock(block(101));

    await ix.commitReady();

    expect(persisted).toEqual([{ slots: [101], checkpoint: 99 }]);
  });

  it('keeps a failed chunk and writes it on the next attempt, after a backoff', async () => {
    ix.window.add(tx(100, 'a'));
    ix.window.addBlock(block(100));
    failNext = 1;

    await ix.commitReady();
    expect(persisted).toEqual([]);
    expect(ix.window.size).toBe(1);
    expect(ix.retryAt).toBeGreaterThan(Date.now());

    // Asked again too soon: nothing is tried.
    await ix.commitReady();
    expect(persisted).toEqual([]);

    ix.retryAt = 0;
    await ix.commitReady();
    expect(persisted).toEqual([{ slots: [100], checkpoint: 100 }]);
  });

  it('writes a straggler for a slot already committed at once, without moving the checkpoint back', async () => {
    ix.window.add(tx(100, 'a'));
    ix.window.addBlock(block(100));
    await ix.commitReady();

    ix.window.add(tx(100, 'late'));
    await ix.commitReady();

    expect(persisted).toEqual([
      { slots: [100], checkpoint: 100 },
      { slots: [100], checkpoint: 100 },
    ]);
  });

  it('gives up after repeated failures, so a supervisor can restart it', async () => {
    ix.window.add(tx(100, 'a'));
    ix.window.addBlock(block(100));
    failNext = 1_000;

    for (let i = 0; i < 20 && !ix.failed; i++) {
      ix.retryAt = 0;
      await ix.commitReady();
    }

    expect(ix.failed).toMatch(/refusing commits/);
    expect(ix.window.size).toBe(1);
  });
});
