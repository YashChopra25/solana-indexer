import type { IndexedTransaction, RawBlock, SlotBatch } from '../domain/types';

/**
 * Holds transactions by slot until the slot looks finished, so each slot can be
 * written to Postgres in one go.
 *
 * Transactions and block metadata arrive on the same stream in no particular
 * order, and nothing announces "that was the last transaction of slot N". A
 * slot is treated as done when its block metadata shows up, or when block
 * metadata `flushLag` slots past it has -- whichever happens first.
 *
 * The lag is measured against block metadata, not slot notifications: while
 * the stream replays a backlog, slot notifications can run far ahead of the
 * replayed transactions, and measuring against them would call every replayed
 * slot "left behind" before its transactions had all arrived.
 */

interface Pending {
  block: RawBlock | null;
  /** Keyed by signature: the stream can deliver the same transaction twice. */
  transactions: Map<string, IndexedTransaction>;
}

export class SlotWindow {
  private readonly pending = new Map<number, Pending>();
  private tip = 0;
  private blockTip = 0;
  private transactions = 0;
  /** Slots at or below this are drained whatever their state; see `releaseThrough`. */
  private released = 0;

  constructor(private readonly flushLag: number) {}

  get size(): number {
    return this.pending.size;
  }

  get tipSlot(): number {
    return this.tip;
  }

  /** Transactions held across every buffered slot: what the memory guard watches. */
  get transactionCount(): number {
    return this.transactions;
  }

  /**
   * The oldest slot still buffered, or null. The checkpoint must stay below it:
   * a newer slot can finish first, and moving the checkpoint past an older one
   * still waiting would skip that one on restart.
   */
  oldestSlot(): number | null {
    let oldest: number | null = null;
    for (const slot of this.pending.keys()) if (oldest === null || slot < oldest) oldest = slot;
    return oldest;
  }

  noteTip(slot: number): void {
    if (slot > this.tip) this.tip = slot;
  }

  add(tx: IndexedTransaction): void {
    this.noteTip(tx.slot);
    const entry = this.slotFor(tx.slot);
    if (!entry.transactions.has(tx.signature)) this.transactions++;
    entry.transactions.set(tx.signature, tx);
  }

  addBlock(block: RawBlock): void {
    this.noteTip(block.slot);
    if (block.slot > this.blockTip) this.blockTip = block.slot;
    this.slotFor(block.slot).block = block;
  }

  /**
   * Makes every slot at or below `slot` drainable. Used for slots the
   * checkpoint has already passed: anything buffered there is a straggler for
   * a slot already written, and holding it back would only hold back the
   * checkpoint -- or lose it, if the worker stopped first.
   */
  releaseThrough(slot: number): void {
    if (slot > this.released) this.released = slot;
  }

  /**
   * Puts back slots that were drained but could not be written, so the next
   * flush tries them again. Anything that arrived for those slots in the
   * meantime is kept alongside.
   */
  restore(batches: SlotBatch[]): void {
    for (const batch of batches) {
      const entry = this.slotFor(batch.slot);
      entry.block ??= batch.block;
      for (const tx of batch.transactions) {
        if (entry.transactions.has(tx.signature)) continue;
        entry.transactions.set(tx.signature, tx);
        this.transactions++;
      }
    }
  }

  /**
   * Takes out the oldest ready slots, at most `max` of them. Taking only what
   * one commit will write keeps the rest counted by the memory guard until
   * they are actually on their way to Postgres.
   */
  drainReady(max = Infinity): SlotBatch[] {
    const ready: number[] = [];

    for (const [slot, entry] of this.pending) {
      const finished = entry.block !== null;
      const leftBehind = slot <= this.blockTip - this.flushLag || slot <= this.released;
      if (finished || leftBehind) ready.push(slot);
    }

    // Oldest first, so the checkpoint only moves forward.
    return ready
      .sort((a, b) => a - b)
      .slice(0, max)
      .map((slot) => {
        const entry = this.pending.get(slot)!;
        this.pending.delete(slot);
        this.transactions -= entry.transactions.size;

        return {
          slot,
          block: entry.block,
          transactions: [...entry.transactions.values()].sort(
            (a, b) => a.transactionIndex - b.transactionIndex,
          ),
        };
      });
  }

  private slotFor(slot: number): Pending {
    let entry = this.pending.get(slot);

    if (!entry) {
      entry = { block: null, transactions: new Map() };
      this.pending.set(slot, entry);
    }

    return entry;
  }
}
