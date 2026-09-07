import { findSwaps } from '@/store/read';
import { assertAddress, optional, paginate, parsePage, respond } from '@/server/http';
import { serializeSwap } from '@/server/serialize';
import { swapMints, symbolsOf } from '@/server/symbols';

export const dynamic = 'force-dynamic';

/**
 * GET /api/swaps — every swap, newest first. `?owner=` `?mint=` `?program=`.
 *
 * `mint` matches either side of the trade, and `program` matches both the
 * program credited with the swap and any venue the route passed through.
 */
export async function GET(request: Request) {
  return respond('/api/swaps', async () => {
    const params = new URL(request.url).searchParams;
    const page = parsePage(params);

    const owner = optional(params, 'owner');
    const mint = optional(params, 'mint');
    const programId = optional(params, 'program');

    if (owner) assertAddress(owner, 'owner');
    if (mint) assertAddress(mint, 'mint');
    if (programId) assertAddress(programId, 'program');

    const rows = await findSwaps(
      { owner: owner ?? undefined, mint: mint ?? undefined, programId: programId ?? undefined },
      page,
    );

    const { data, pagination } = paginate(rows, page);
    const symbols = await symbolsOf(swapMints(data));

    return { data: data.map((row) => serializeSwap(row, symbols)), pagination };
  });
}
