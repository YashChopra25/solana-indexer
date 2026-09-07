import { findTransfers } from '@/store/read';
import { assertAddress, assertOneOf, optional, paginate, parsePage, respond } from '@/server/http';
import { serializeTransfer } from '@/server/serialize';
import { symbolsOf, transferMints } from '@/server/symbols';

export const dynamic = 'force-dynamic';

/**
 * GET /api/wallets/:address/transfers — transfers with the address on either
 * side, as the token account or as the wallet that owns it.
 */
export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;

  return respond('/api/wallets/[address]/transfers', async () => {
    assertAddress(address);

    const params = new URL(request.url).searchParams;
    const page = parsePage(params);
    const mint = optional(params, 'mint');
    const kind = optional(params, 'kind');

    if (mint) assertAddress(mint, 'mint');

    const rows = await findTransfers(
      {
        address,
        mint: mint ?? undefined,
        kind: kind ? assertOneOf(kind, ['sol', 'spl'] as const, 'kind') : undefined,
      },
      page,
    );

    const { data, pagination } = paginate(rows, page);
    const symbols = await symbolsOf(transferMints(data));

    return { address, data: data.map((row) => serializeTransfer(row, symbols)), pagination };
  });
}
