import { findTransactionsByAddress } from '@/store/read';
import { assertAddress, paginate, parsePage, respond } from '@/server/http';
import { serializeTransaction } from '@/server/serialize';

export const dynamic = 'force-dynamic';

/** GET /api/wallets/:address/transactions — anything that touched the address. */
export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;

  return respond('/api/wallets/[address]/transactions', async () => {
    assertAddress(address);

    const page = parsePage(new URL(request.url).searchParams);
    const rows = await findTransactionsByAddress(address, page);
    const { data, pagination } = paginate(rows, page);

    return { address, data: data.map(serializeTransaction), pagination };
  });
}
