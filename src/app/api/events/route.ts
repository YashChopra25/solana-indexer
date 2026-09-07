import { findEvents } from '@/store/read';
import {
  assertAddress,
  assertDiscriminator,
  assertOneOf,
  optional,
  paginate,
  parsePage,
  respond,
} from '@/server/http';
import { serializeEvent } from '@/server/serialize';

export const dynamic = 'force-dynamic';

/**
 * GET /api/events — Anchor events, newest first.
 * `?program=` `?discriminator=` `?source=log|cpi`.
 */
export async function GET(request: Request) {
  return respond('/api/events', async () => {
    const params = new URL(request.url).searchParams;
    const page = parsePage(params);

    const programId = optional(params, 'program');
    const discriminator = optional(params, 'discriminator');
    const source = optional(params, 'source');

    if (programId) assertAddress(programId, 'program');

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
  });
}
