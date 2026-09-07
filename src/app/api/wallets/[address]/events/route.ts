import { findActivity } from '@/store/read';
import { assertAddress, paginate, parsePage, respond } from '@/server/http';
import { serializeActivity } from '@/server/serialize';
import { activityMints, symbolsOf } from '@/server/symbols';

export const dynamic = 'force-dynamic';

/**
 * GET /api/wallets/:address/events — program events from transactions this
 * wallet signed.
 *
 * An event belongs to a program, not to a wallet, so "this wallet's events"
 * can only mean the events its own transactions caused.
 */
export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;

  return respond('/api/wallets/[address]/events', async () => {
    assertAddress(address);

    const page = parsePage(new URL(request.url).searchParams);
    const rows = await findActivity(address, ['event'], page);
    const { data, pagination } = paginate(rows, page);
    const symbols = await symbolsOf(activityMints(data));

    return { address, data: data.map((row) => serializeActivity(row, symbols)), pagination };
  });
}
