import { findTransfers } from '@/store/read';
import { assertAddress, assertOneOf, optional, paginate, parsePage, respond } from '@/server/http';
import { serializeTransfer } from '@/server/serialize';
import { symbolsOf, transferMints } from '@/server/symbols';

export const dynamic = 'force-dynamic';

/** GET /api/transfers — every transfer, newest first. `?address=` `?mint=` `?kind=`. */
export async function GET(request: Request) {
  return respond('/api/transfers', async () => {
    const params = new URL(request.url).searchParams;
    const page = parsePage(params);

    const address = optional(params, 'address');
    const mint = optional(params, 'mint');
    const kind = optional(params, 'kind');

    if (address) assertAddress(address);
    if (mint) assertAddress(mint, 'mint');

    const rows = await findTransfers(
      {
        address: address ?? undefined,
        mint: mint ?? undefined,
        kind: kind ? assertOneOf(kind, ['sol', 'spl'] as const, 'kind') : undefined,
      },
      page,
    );

    const { data, pagination } = paginate(rows, page);
    const symbols = await symbolsOf(transferMints(data));

    return { data: data.map((row) => serializeTransfer(row, symbols)), pagination };
  });
}
