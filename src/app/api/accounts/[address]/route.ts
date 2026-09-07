import { findAccountUpdates } from '@/store/read';
import { assertAddress, paginate, parsePage, respond } from '@/server/http';
import { serializeAccountUpdate } from '@/server/serialize';

export const dynamic = 'force-dynamic';

/**
 * GET /api/accounts/:address — writes to one account, newest first.
 *
 * Fed by the `accounts` subscription, which the worker opens only for watched
 * addresses. An unwatched address answers with an empty list rather than a 404:
 * the address is perfectly valid, nothing has simply been recorded for it.
 */
export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;

  return respond('/api/accounts/[address]', async () => {
    assertAddress(address);

    const page = parsePage(new URL(request.url).searchParams);
    const rows = await findAccountUpdates(address, page);
    const { data, pagination } = paginate(rows, page);

    return { address, data: data.map(serializeAccountUpdate), pagination };
  });
}
