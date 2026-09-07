import { findActivity } from '@/store/read';
import { assertAddress, optional, paginate, parsePage, respond, BadRequestError } from '@/server/http';
import { serializeActivity } from '@/server/serialize';
import { activityMints, symbolsOf } from '@/server/symbols';

export const dynamic = 'force-dynamic';

const KINDS = ['transfer', 'swap', 'event'] as const;
type Kind = (typeof KINDS)[number];

/**
 * GET /api/wallets/:address/activity — one timeline merging this wallet's
 * transfers, swaps and program events, newest first.
 *
 * `?kind=` narrows it, comma-separated: `?kind=swap,transfer`. The typed
 * endpoints next to this one return the same records with their full detail;
 * this is the view for "what has this wallet been doing?".
 */
export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;

  return respond('/api/wallets/[address]/activity', async () => {
    assertAddress(address);

    const params = new URL(request.url).searchParams;
    const page = parsePage(params);

    const rows = await findActivity(address, parseKinds(optional(params, 'kind')), page);
    const { data, pagination } = paginate(rows, page);
    const symbols = await symbolsOf(activityMints(data));

    return { address, data: data.map((row) => serializeActivity(row, symbols)), pagination };
  });
}

function parseKinds(value: string | null): Kind[] {
  if (!value) return [...KINDS];

  const requested = value.split(',').map((kind) => kind.trim()).filter(Boolean);
  const unknown = requested.filter((kind) => !(KINDS as readonly string[]).includes(kind));

  if (unknown.length > 0) {
    throw new BadRequestError(`kind must be one of: ${KINDS.join(', ')}`);
  }

  return requested as Kind[];
}
