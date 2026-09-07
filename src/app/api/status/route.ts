import { readIndexerState, readTotals } from '@/store/read';
import { respond } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Solana aims for a 400ms slot, so about 2.5 slots go by every second. */
const SLOTS_PER_SECOND = 2.5;

/** GET /api/status — how far along the indexer is, and what it has stored. */
export async function GET() {
  return respond('/api/status', async () => {
    const [state, totals] = await Promise.all([readIndexerState(), readTotals()]);

    const lastBlockTime = state?.last_block_time ? new Date(state.last_block_time) : null;
    const lastProcessedSlot = Number(state?.last_processed_slot ?? 0);

    // The honest measure of "how far behind are we": the age of the newest
    // block we have indexed.
    const lagSeconds = lastBlockTime
      ? Math.round((Date.now() - lastBlockTime.getTime()) / 1000)
      : null;

    return {
      indexer: {
        lastProcessedSlot,
        lastBlockTime: lastBlockTime?.toISOString() ?? null,
        lagSeconds,
        // The indexer never sees the chain tip -- it only knows the last slot it
        // wrote. This projects the tip from the lag, so it is an estimate.
        estimatedTipSlot:
          lagSeconds === null || lastProcessedSlot === 0
            ? null
            : lastProcessedSlot + Math.max(0, Math.round(lagSeconds * SLOTS_PER_SECOND)),
        slotsProcessed: Number(state?.slots_processed ?? 0),
        updatedAt: state?.updated_at ? new Date(state.updated_at).toISOString() : null,
      },
      totals: {
        slots: Number(totals?.slots ?? 0),
        transactions: Number(totals?.transactions ?? 0),
        transfers: Number(totals?.transfers ?? 0),
        swaps: Number(totals?.swaps ?? 0),
        events: Number(totals?.events ?? 0),
        accounts: Number(totals?.accounts ?? 0),
        tokens: Number(totals?.tokens ?? 0),
      },
    };
  });
}
