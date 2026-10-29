import { shared } from '@/server/cache';
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

  // Shared briefly: every open console tab on this page asks the same thing.
  return respond('/api/wallets/[address]/events', () => shared(`wallet-events:${address}?${new URL(request.url).searchParams}`, 2_000, async () => {
    assertAddress(address);

    const page = parsePage(new URL(request.url).searchParams);
    const rows = await findActivity(address, ['event'], page);
    const { data, pagination } = paginate(rows, page);
    const symbols = await symbolsOf(activityMints(data));

    return { address, data: data.map((row) => serializeActivity(row, symbols)), pagination };
  }));
}
