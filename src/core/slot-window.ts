import type { IndexedTransaction, RawBlock, SlotBatch } from '../domain/types';

/**
 * Holds transactions by slot until the slot looks finished, so each slot can be
 * written to Postgres in one go.
 *
 * Transactions and block metadata arrive on the same stream in no particular
 * order, and nothing announces "that was the last transaction of slot N". A
 * slot is treated as done when its block metadata shows up, or when the chain
 * has moved `flushLag` slots past it — whichever happens first.
 */

interface Pending {
  block: RawBlock | null;
  /** Keyed by signature: the stream can deliver the same transaction twice. */
  transactions: Map<string, IndexedTransaction>;
}

export class SlotWindow {
  private readonly pending = new Map<number, Pending>();
  private tip = 0;
  private draining = false;

  constructor(private readonly flushLag: number) {}

  get size(): number {
    return this.pending.size;
  }

  get tipSlot(): number {
    return this.tip;
  }

  noteTip(slot: number): void {
    if (slot > this.tip) this.tip = slot;
  }

  add(tx: IndexedTransaction): void {
    this.noteTip(tx.slot);
    this.slotFor(tx.slot).transactions.set(tx.signature, tx);
  }

  addBlock(block: RawBlock): void {
    this.noteTip(block.slot);
    this.slotFor(block.slot).block = block;
  }

  /** Marks everything ready, so a clean shutdown commits what it is holding. */
  releaseAll(): void {
    this.draining = true;
  }

  /** Takes out every slot that is ready, oldest first. */
  drainReady(): SlotBatch[] {
    const ready: SlotBatch[] = [];

    for (const [slot, entry] of this.pending) {
      const finished = entry.block !== null;
      const leftBehind = this.draining || slot <= this.tip - this.flushLag;
      if (!finished && !leftBehind) continue;

      this.pending.delete(slot);
      ready.push({
        slot,
        block: entry.block,
        transactions: [...entry.transactions.values()].sort(
          (a, b) => a.transactionIndex - b.transactionIndex,
        ),
      });
    }

    // Oldest first, so the checkpoint only ever moves forward.
    return ready.sort((a, b) => a.slot - b.slot);
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
