import { NextResponse, type NextRequest } from 'next/server';
import { checkKey, hashKey, readKey } from '@/access/keys';
import { PLANS, type PlanName } from '@/access/plans';
import { CONSOLE_COOKIE, SESSION_COOKIE, isAdminSession, isHttps } from '@/access/session';
import { createLogger, errorMessage } from '@/lib/logger';
import { countRequest, findKey } from '@/store/access';

/**
 * The one door every request comes through.
 *
 *  - The console is open to anyone: every page, and the /api/* calls those
 *    pages make from the browser, writes to the watchlist included.
 *  - A customer calls /api/* from their own code with
 *    `Authorization: Bearer sk_...`. The key must be live, paid up and under
 *    its monthly quota, and it can only read.
 *  - /admin, where customers and their API keys are managed, needs the
 *    operator's session, signed in with ADMIN_PASSWORD.
 *  - Anything else calling /api/* without a key gets a 401.
 *
 * Doing this here rather than in each route means a new route is covered the
 * moment it exists, with nothing to remember.
 */

const log = createLogger('access');

/** Reachable by anyone, from anywhere: the way in and out, and the liveness probe. */
const OPEN_PATHS = new Set(['/login', '/api/login', '/api/logout', '/api/health']);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');
  const isAdmin = isAdminSession(request.cookies.get(SESSION_COOKIE)?.value);

  if (OPEN_PATHS.has(pathname)) return NextResponse.next();

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (isAdmin) return NextResponse.next();

    const login = new URL('/login', publicOrigin(request));
    login.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  if (!isApi) return openPage(request);

  const key = readKey(request.headers);
  if (key) return await admitKey(request, key);

  if (isAdmin || request.cookies.has(CONSOLE_COOKIE)) return NextResponse.next();

  return Response.json(
    { error: 'missing API key: send it as "Authorization: Bearer sk_..."' },
    { status: 401 },
  );
}

/**
 * This site as the browser reached it. request.url is built from the address
 * the server is bound to (0.0.0.0 in Docker), so a redirect made from it sends
 * people somewhere they cannot reach. The proxy must redirect to an absolute
 * URL, so it is rebuilt from the Host header, or a TLS proxy's forwarded one.
 */
function publicOrigin(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host;
  return `${isHttps(request) ? 'https' : 'http'}://${host}`;
}

/**
 * Every page but /admin is public. Serving one also hands the browser the
 * console cookie, which is what lets that page's own /api/* calls through
 * without a key.
 *
 * SameSite=Lax keeps a page on another site from sending it, so other sites
 * cannot write to the watchlist through a visitor's browser. Anyone can get
 * the cookie by loading a page, though: it keeps the console free to use, it
 * does not lock the API. Plain cookies work over plain http, which the
 * browser's Sec-Fetch-* headers do not.
 */
function openPage(request: NextRequest): NextResponse {
  const response = NextResponse.next();

  if (!request.cookies.has(CONSOLE_COOKIE)) {
    response.cookies.set(CONSOLE_COOKIE, '1', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps(request),
      maxAge: 365 * 24 * 60 * 60,
    });
  }

  return response;
}

async function admitKey(request: NextRequest, key: string): Promise<Response> {
  // Keys are for reading data. The watchlist decides what the indexer
  // subscribes to, and is changed from the console, not by a customer's code.
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
