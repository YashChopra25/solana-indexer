import {
  findAccountUpdates,
  findEvents,
  findInvocationsByProgram,
  findProgram,
  findProgramEventTypes,
} from '@/store/read';
import { programLabel } from '@/chain/programs';
import { NotFoundError, assertAddress, paginate, parsePage, respond } from '@/server/http';
import { serializeAccountUpdate, serializeEvent, serializeInvocation } from '@/server/serialize';

export const dynamic = 'force-dynamic';

/** How many distinct event types to list for a program. */
const EVENT_TYPE_LIMIT = 25;

/**
 * GET /api/programs/:programId — everything the index knows about one program:
 * how often it ran, how many swaps are credited to it, which event types it
 * emits, and its most recent events and invocations.
 *
 * The event types are discriminators rather than names: naming them needs the
 * program's IDL, which this indexer does not hold.
 */
export async function GET(request: Request, ctx: { params: Promise<{ programId: string }> }) {
  const { programId } = await ctx.params;

  return respond('/api/programs/[programId]', async () => {
    assertAddress(programId, 'program');

    const page = parsePage(new URL(request.url).searchParams);

    const [summary, eventTypes, eventRows, invocationRows, accountRows] = await Promise.all([
      findProgram(programId),
      findProgramEventTypes(programId, EVENT_TYPE_LIMIT),
      findEvents({ programId }, page),
      findInvocationsByProgram(programId, page),
      findAccountUpdates(programId, page),
    ]);

    const invocationCount = Number(summary?.invocation_count ?? 0);
    const eventCount = Number(summary?.event_count ?? 0);

    // A program nothing has invoked and nothing has written to is not an error
    // in the request, but it is nothing to show either.
    if (invocationCount === 0 && eventCount === 0 && accountRows.length === 0) {
      throw new NotFoundError(`program ${programId} has not been seen`);
    }

    return {
      program: { id: programId, label: programLabel(programId) },
      invocationCount,
      eventCount,
      swapCount: Number(summary?.swap_count ?? 0),
      lastSlot: summary?.last_slot ?? null,
      eventTypes: eventTypes.map((row) => ({
        discriminator: row.discriminator,
        source: row.source,
        count: Number(row.count),
        lastSlot: row.last_slot,
      })),
      events: paginate(eventRows, page).data.map(serializeEvent),
      invocations: paginate(invocationRows, page).data.map((row) => ({
        ...serializeInvocation(row),
        signature: row.signature,
        slot: row.slot,
      })),
      // Only ever non-empty while the program is watched: these come from the
      // accounts subscription, which exists only for watched addresses.
      accountUpdates: paginate(accountRows, page).data.map(serializeAccountUpdate),
    };
  });
}
