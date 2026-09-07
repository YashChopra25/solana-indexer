import { describe, expect, it } from 'vitest';
import { SlotWindow } from '../../src/core/slot-window';
import type { IndexedTransaction, RawBlock } from '../../src/domain/types';

const FLUSH_LAG = 24;

function tx(slot: number, signature: string, index = 0): IndexedTransaction {
  return {
    signature,
    slot,
    transactionIndex: index,
    success: true,
    err: null,
    fee: 5000n,
    computeUnits: null,
    recentBlockhash: 'hash',
    versioned: false,
    feePayer: null,
    signers: [],
    accounts: [],
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

function block(slot: number): RawBlock {
  return {
    slot,
    blockhash: `hash-${slot}`,
    parentSlot: slot - 1,
    blockTime: 1_700_000_000,
    blockHeight: slot,
    transactionCount: 1,
  };
}

describe('SlotWindow', () => {
  it('holds a slot until its block metadata arrives', () => {
    const window = new SlotWindow(FLUSH_LAG);
    window.add(tx(100, 'a'));

    expect(window.drainReady()).toEqual([]);

    window.addBlock(block(100));
    expect(window.drainReady().map((b) => b.slot)).toEqual([100]);
  });

  it('flushes a slot once the tip moves past the lag threshold', () => {
    const window = new SlotWindow(FLUSH_LAG);
    window.add(tx(100, 'a'));
    window.noteTip(100 + FLUSH_LAG);

    expect(window.drainReady().map((b) => b.slot)).toEqual([100]);
  });

  it('de-duplicates a transaction replayed after a reconnect', () => {
    const window = new SlotWindow(FLUSH_LAG);
    window.add(tx(100, 'a'));
    window.add(tx(100, 'a'));
    window.addBlock(block(100));

    expect(window.drainReady()[0].transactions).toHaveLength(1);
  });

  it('orders transactions within a slot by transaction index', () => {
    const window = new SlotWindow(FLUSH_LAG);
    window.add(tx(100, 'b', 2));
    window.add(tx(100, 'a', 1));
    window.addBlock(block(100));

    expect(window.drainReady()[0].transactions.map((t) => t.transactionIndex)).toEqual([1, 2]);
  });

  it('drains oldest first, so the checkpoint only moves forward', () => {
    const window = new SlotWindow(FLUSH_LAG);
    window.add(tx(102, 'c'));
    window.add(tx(100, 'a'));
    window.addBlock(block(102));
    window.addBlock(block(100));

    expect(window.drainReady().map((b) => b.slot)).toEqual([100, 102]);
  });

  it('removes drained slots from the buffer', () => {
    const window = new SlotWindow(FLUSH_LAG);
    window.add(tx(100, 'a'));
    window.addBlock(block(100));
    window.drainReady();

    expect(window.size).toBe(0);
    expect(window.drainReady()).toEqual([]);
  });

  it('releaseAll makes unfinished slots drainable at shutdown', () => {
    const window = new SlotWindow(FLUSH_LAG);
    window.add(tx(100, 'a'));

    expect(window.drainReady()).toEqual([]);

    window.releaseAll();
    expect(window.drainReady().map((b) => b.slot)).toEqual([100]);
  });

  it('tracks the highest slot it has been told about', () => {
    const window = new SlotWindow(FLUSH_LAG);
    window.noteTip(500);
    window.noteTip(100);

    expect(window.tipSlot).toBe(500);
  });
});
