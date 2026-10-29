import { shared } from '@/server/cache';
import { findTransactionsByAddress } from '@/store/read';
import { assertAddress, paginate, parsePage, respond } from '@/server/http';
import { serializeTransaction } from '@/server/serialize';

export const dynamic = 'force-dynamic';

/** GET /api/wallets/:address/transactions — anything that touched the address. */
export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;

  // Shared briefly: every open console tab on this page asks the same thing.
  return respond('/api/wallets/[address]/transactions', () => shared(`wallet-transactions:${address}?${new URL(request.url).searchParams}`, 2_000, async () => {
    assertAddress(address);

    const page = parsePage(new URL(request.url).searchParams);
    const rows = await findTransactionsByAddress(address, page);
    const { data, pagination } = paginate(rows, page);

    return { address, data: data.map(serializeTransaction), pagination };
  }));
}
