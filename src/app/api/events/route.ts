import { findEvents } from '@/store/read';
import {
  BadRequestError,
  assertAddress,
  assertDiscriminator,
  assertOneOf,
  optional,
  paginate,
  parsePage,
  respond,
} from '@/server/http';
import { shared } from '@/server/cache';
import { serializeEvent } from '@/server/serialize';

export const dynamic = 'force-dynamic';

/**
 * GET /api/events — Anchor events, newest first.
 * `?program=` `?discriminator=` `?source=log|cpi`.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  // Every open console polls this with the same query; one answer a second is
  // shared between them all.
  return respond('/api/events', () => shared(`/api/events?${params}`, 1_000, async () => {
    const page = parsePage(params);

    const programId = optional(params, 'program');
    const discriminator = optional(params, 'discriminator');
    const source = optional(params, 'source');

    if (programId) assertAddress(programId, 'program');
    // Event types are indexed under their program; without one, a code that
    // never matches would mean reading the whole table to say so.
    if (discriminator && !programId) {
      throw new BadRequestError('discriminator needs program: event codes are only unique within a program');
    }

    const rows = await findEvents(
      {
        programId: programId ?? undefined,
        discriminator: discriminator ? assertDiscriminator(discriminator) : undefined,
        source: source ? assertOneOf(source, ['log', 'cpi'] as const, 'source') : undefined,
      },
      page,
    );

    const { data, pagination } = paginate(rows, page);
    return { data: data.map(serializeEvent), pagination };
  }));
}
