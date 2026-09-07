import {
  findEventsOf,
  findInstructions,
  findInvocations,
  findSwapsOf,
  findTransaction,
  findTransfersOf,
} from '@/store/read';
import { NotFoundError, assertSignature, respond } from '@/server/http';
import {
  serializeEvent,
  serializeInstruction,
  serializeInvocation,
  serializeSwap,
  serializeTransaction,
  serializeTransfer,
} from '@/server/serialize';
import { swapMints, symbolsOf, transferMints } from '@/server/symbols';

export const dynamic = 'force-dynamic';

/**
 * GET /api/transactions/:signature — one transaction with everything extracted
 * from it: instructions, transfers, swaps, events and the program call tree.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ signature: string }> }) {
  const { signature } = await ctx.params;

  return respond('/api/transactions/[signature]', async () => {
    assertSignature(signature);

    const transaction = await findTransaction(signature);
    if (!transaction) throw new NotFoundError(`transaction ${signature} is not indexed`);

    const [instructions, transfers, swaps, events, invocations] = await Promise.all([
      findInstructions(signature),
      findTransfersOf(signature),
      findSwapsOf(signature),
      findEventsOf(signature),
      findInvocations(signature),
    ]);

    // One lookup for the whole transaction: its transfers and its swaps name
    // the same handful of mints, so asking once covers both.
    const symbols = await symbolsOf([...transferMints(transfers), ...swapMints(swaps)]);

    return {
      ...serializeTransaction(transaction),
      instructions: instructions.map(serializeInstruction),
      transfers: transfers.map((row) => serializeTransfer(row, symbols)),
      swaps: swaps.map((row) => serializeSwap(row, symbols)),
      events: events.map(serializeEvent),
      invocations: invocations.map(serializeInvocation),
    };
  });
}
