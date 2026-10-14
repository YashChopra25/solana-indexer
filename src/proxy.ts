import { NextResponse, type NextRequest } from 'next/server';
import { checkKey, hashKey, readKey } from '@/access/keys';
import { PLANS, type PlanName } from '@/access/plans';
import { SESSION_COOKIE, isAdminSession } from '@/access/session';
import { createLogger, errorMessage } from '@/lib/logger';
import { countRequest, findKey } from '@/store/access';

/**
 * The one door every request comes through.
 *
 *  - A customer calls /api/* with `Authorization: Bearer sk_...`. The key must
 *    be live, paid up and under its monthly quota, and it can only read.
 *  - The operator uses the console, signed in with ADMIN_PASSWORD. Their
 *    session cookie opens every page and every API route, writes included.
 *  - Anyone else gets a 401 from the API, or the login page.
 *
 * Doing this here rather than in each route means a new route is protected the
 * moment it exists, with nothing to remember.
 */

const log = createLogger('access');

/** Reachable without signing in: the way in and out, the API docs, and the liveness probe. */
const OPEN_PATHS = new Set(['/login', '/api/login', '/api/logout', '/api/health', '/docs']);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  if (OPEN_PATHS.has(pathname)) return NextResponse.next();

  const key = isApi ? readKey(request.headers) : null;
  if (key) return await admitKey(request, key);

  if (isAdminSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (isApi) {
    return Response.json(
      { error: 'missing API key: send it as "Authorization: Bearer sk_..."' },
      { status: 401 },
    );
  }

  const login = new URL('/login', request.url);
  login.searchParams.set('next', pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

async function admitKey(request: NextRequest, key: string): Promise<Response> {
  // The watchlist decides what the indexer subscribes to, for everyone. That
  // is the operator's call, not something a customer's key should change.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return Response.json({ error: 'API keys are read-only' }, { status: 403 });
  }

  try {
    const record = await findKey(hashKey(key));
    const verdict = checkKey(record, new Date());

    if (!verdict.ok) return Response.json({ error: verdict.error }, { status: verdict.status });

    // checkKey has confirmed both of these.
    const { customerId, plan } = record!;
    const quota = PLANS[plan as PlanName].monthlyRequests;
    const used = await countRequest(customerId, quota);

    const headers = {
      'X-Quota-Limit': String(quota),
      'X-Quota-Remaining': String(used === null ? 0 : quota - used),
    };

    if (used === null) {
      return Response.json(
        { error: 'monthly request quota used up; it resets on the 1st (UTC)' },
        { status: 429, headers },
      );
    }

    return NextResponse.next({ headers });
  } catch (err) {
    log.error('key check failed', { error: errorMessage(err) });
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}

export const config = {
  // Everything but build assets and the files in public/.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)'],
};
