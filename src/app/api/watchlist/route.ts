import { cookies } from 'next/headers';
import { CONSOLE_COOKIE, SESSION_COOKIE, isAdminSession, readVisitor } from '@/access/session';
import { isUnwatchableProgram } from '@/chain/programs';
import { MAX_WATCHES, MAX_WATCHES_PER_VISITOR } from '@/config';
import {
  addWatched,
  listWatched,
  refreshClaims,
  removeWatched,
  WatchLimitError,
  type Watcher,
  type WatchKind,
} from '@/store/watchlist';
import {
  assertAddress,
  assertOneOf,
  respond,
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '@/server/http';

export const dynamic = 'force-dynamic';

const KINDS = ['program', 'wallet'] as const;

/** Long enough to be useful, short enough to still be a label. */
const MAX_LABEL = 80;

/**
 * The watchlist the indexer acts on.
 *
 * A browser keeps its own copy in IndexedDB and mirrors it here, because the
 * worker cannot see IndexedDB -- it shares nothing with the web app but
 * Postgres. Each entry remembers which browsers asked for it (by the id in
 * their console cookie), so removing it in one browser stops the indexer
 * watching it only once no other browser still wants it.
 */
export async function GET() {
  return respond('/api/watchlist', async () => {
    const who = await watcher();
    if (who && 'visitor' in who) await refreshClaims(who.visitor);
    return { data: await listWatched(who) };
  });
}

export async function POST(request: Request) {
  return respond('/api/watchlist', async () => {
    const who = await requireWatcher();
    const { kind, address, label } = await parseBody(request);

    if (kind === 'program' && isUnwatchableProgram(address)) {
      throw new BadRequestError(
        'this program owns too much of the chain to follow by itself; watch the apps built on it instead',
      );
    }

    try {
      return await addWatched(who, kind, address, label, {
        total: MAX_WATCHES,
        perVisitor: MAX_WATCHES_PER_VISITOR,
      });
    } catch (err) {
      if (err instanceof WatchLimitError) throw new ConflictError(err.message);
      throw err;
    }
  });
}

export async function DELETE(request: Request) {
  return respond('/api/watchlist', async () => {
    const who = await requireWatcher();
    const { kind, address } = await parseBody(request);

    if (!(await removeWatched(who, kind, address))) {
      throw new NotFoundError(`${kind} ${address} is not being watched by this browser`);
    }

    return { kind, address, removed: true };
  });
}

/** The operator if signed in, else this browser's console id, else nobody. */
async function watcher(): Promise<Watcher | null> {
  const jar = await cookies();
  if (isAdminSession(jar.get(SESSION_COOKIE)?.value)) return { operator: true };

  const visitor = readVisitor(jar.get(CONSOLE_COOKIE)?.value);
  return visitor ? { visitor } : null;
}

async function requireWatcher(): Promise<Watcher> {
  const who = await watcher();
  // The proxy lets no cookieless request this far; this is the second lock.
  if (!who) throw new BadRequestError('open the console in a browser to change the watchlist');
  return who;
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
