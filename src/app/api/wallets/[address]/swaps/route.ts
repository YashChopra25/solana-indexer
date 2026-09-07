import { findSwaps } from '@/store/read';
import { assertAddress, optional, paginate, parsePage, respond } from '@/server/http';
import { serializeSwap } from '@/server/serialize';
import { swapMints, symbolsOf } from '@/server/symbols';

export const dynamic = 'force-dynamic';

/** GET /api/wallets/:address/swaps — swaps this wallet signed for. */
export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;

  return respond('/api/wallets/[address]/swaps', async () => {
    assertAddress(address);

    const params = new URL(request.url).searchParams;
    const page = parsePage(params);
    const mint = optional(params, 'mint');

    if (mint) assertAddress(mint, 'mint');

    const rows = await findSwaps({ owner: address, mint: mint ?? undefined }, page);
    const { data, pagination } = paginate(rows, page);
    const symbols = await symbolsOf(swapMints(data));

    return { address, data: data.map((row) => serializeSwap(row, symbols)), pagination };
  });
}
