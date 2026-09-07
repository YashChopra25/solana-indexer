import { addWatched, listWatched, removeWatched, type WatchKind } from '@/store/watchlist';
import { assertAddress, assertOneOf, respond, BadRequestError, NotFoundError } from '@/server/http';

export const dynamic = 'force-dynamic';

const KINDS = ['program', 'wallet'] as const;

/** Long enough to be useful, short enough to still be a label. */
const MAX_LABEL = 80;

/**
 * The watchlist the indexer acts on.
 *
 * A browser keeps its own copy in IndexedDB and mirrors it here, because the
 * worker cannot see IndexedDB — it shares nothing with the web app but
 * Postgres. That makes this list the union of what every browser has asked for
 * rather than any one person's, so removing an entry stops the indexer watching
 * it for everyone.
 */
export async function GET() {
  return respond('/api/watchlist', async () => ({ data: await listWatched() }));
}

export async function POST(request: Request) {
  return respond('/api/watchlist', async () => {
    const { kind, address, label } = await parseBody(request);

    return await addWatched(kind, address, label);
  });
}

export async function DELETE(request: Request) {
  return respond('/api/watchlist', async () => {
    const { kind, address } = await parseBody(request);

    if (!(await removeWatched(kind, address))) {
      throw new NotFoundError(`${kind} ${address} is not being watched`);
    }

    return { kind, address, removed: true };
  });
}

async function parseBody(request: Request): Promise<{
  kind: WatchKind;
  address: string;
  label: string | null;
}> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new BadRequestError('body must be JSON');
  }

  const { kind, address, label } = (body ?? {}) as Record<string, unknown>;

  if (typeof kind !== 'string' || typeof address !== 'string') {
    throw new BadRequestError('kind and address are required');
  }

  if (label !== undefined && label !== null && typeof label !== 'string') {
    throw new BadRequestError('label must be a string');
  }

  // A program id is an account like any other, so both kinds validate the same
  // way. The kind is what the console groups by, not a different address shape.
  return {
    kind: assertOneOf(kind, KINDS, 'kind'),
    address: assertAddress(address),
    label: typeof label === 'string' ? label.trim().slice(0, MAX_LABEL) || null : null,
  };
}
