import { getPool } from '@/store/pool';
import { respond } from '@/server/http';

// Every endpoint reads live indexer state, so none can be prerendered.
export const dynamic = 'force-dynamic';

/** GET /api/health — is the server up, and can it reach Postgres? */
export async function GET() {
  return respond('/api/health', async () => {
    await getPool().query('SELECT 1');
    return { status: 'ok', service: 'solana-indexer', time: new Date().toISOString() };
  });
}
