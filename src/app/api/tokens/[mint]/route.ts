import { findToken } from '@/store/read';
import { NotFoundError, assertAddress, respond } from '@/server/http';

export const dynamic = 'force-dynamic';

/** GET /api/tokens/:mint — a mint, and how much it has moved and traded. */
export async function GET(_request: Request, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;

  return respond('/api/tokens/[mint]', async () => {
    assertAddress(mint, 'mint');

    const token = await findToken(mint);
    if (!token) throw new NotFoundError(`token ${mint} is not indexed`);

    return {
      mint: token.mint,
      decimals: token.decimals,
      programId: token.program_id,
      firstSeenSlot: token.first_seen_slot,
      lastSlot: token.last_slot,
      transferCount: Number(token.transfer_count ?? 0),
      swapCount: Number(token.swap_count ?? 0),
      updatedAt: token.updated_at ? new Date(token.updated_at).toISOString() : null,
    };
  });
}
