import { NextResponse, type NextRequest } from 'next/server';
import { checkKey, hashKey, readKey } from '@/access/keys';
import { PLANS, type PlanName } from '@/access/plans';
import { BILLED_CUSTOMER_HEADER } from '@/access/billing';
import { clientAddress, RateLimiter } from '@/access/rate-limit';
import {
  CONSOLE_COOKIE,
  SESSION_COOKIE,
  isAdminSession,
  isHttps,
  newVisitorCookie,
  readVisitor,
} from '@/access/session';
import { PUBLIC_URL } from '@/config';
import { createLogger, errorMessage } from '@/lib/logger';
import { countRequest, findKey } from '@/store/access';

/**
 * The one door every request comes through.
 *
 *  - The console is open to anyone: every page, and the /api/* calls those
 *    pages make from the browser, writes to the watchlist included. Those calls
 *    carry a signed `console` cookie the pages hand out, and are held to a pace
 *    a person reading the console never notices but a scraper does.
 *  - A customer calls /api/* from their own code with
 *    `Authorization: Bearer sk_...`. The key must be live, paid up and under
 *    its monthly quota, and it can only read data.
 *  - /admin, where customers and their API keys are managed, needs the
 *    operator's session, signed in with ADMIN_PASSWORD.
 *  - Anything else calling /api/* gets a 401.
 *
 * Doing this here rather than in each route means a new route is covered the
 * moment it exists, with nothing to remember.
 */

const log = createLogger('access');

/** Reachable by anyone, from anywhere: the way in and out, and the liveness probe. */
const OPEN_PATHS = new Set(['/login', '/api/login', '/api/logout', '/api/health']);

/**
 * Per-client limits, so one script cannot drain Postgres or guess the admin
 * password. An open console tab makes about thirty requests a minute.
 *
 * Console calls are limited per browser and, more loosely, per network, so a
 * team behind one office address is not throttled as if it were one person.
 * Keyed calls are limited per network before the key is even looked up, so
 * made-up keys cost nothing, and then per key on top of its monthly quota.
 */
const LIMITS = {
  visitor: new RateLimiter({ max: 90, windowMs: 60_000 }),
  network: new RateLimiter({ max: 600, windowMs: 60_000 }),
  keyNetwork: new RateLimiter({ max: 3_000, windowMs: 60_000 }),
  key: new RateLimiter({ max: 1_200, windowMs: 60_000 }),
  login: new RateLimiter({ max: 10, windowMs: 15 * 60_000 }),
  watchlistWrite: new RateLimiter({ max: 30, windowMs: 60 * 60_000 }),
};

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');
  const isAdmin = isAdminSession(request.cookies.get(SESSION_COOKIE)?.value);
  const client = clientAddress(request.headers);

  if (pathname === '/api/login' && request.method === 'POST') {
    const limited = throttle(LIMITS.login, client, 'too many sign-in attempts; try again later');
    if (limited) return limited;
  }

  if (OPEN_PATHS.has(pathname)) return passThrough(request);

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (isAdmin) return passThrough(request);

    const login = new URL('/login', publicOrigin(request));
    login.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  if (!isApi) return openPage(request);

  const key = readKey(request.headers);
  if (key) {
    const limited =
      throttle(LIMITS.keyNetwork, client, 'too many requests from this network; slow down') ??
      throttle(LIMITS.key, hashKey(key), 'too many requests for this key; slow down');
    return limited ?? (await admitKey(request, key));
  }

  // The operator is trusted with everything, unthrottled.
  if (isAdmin) return passThrough(request);

  const visitor = readVisitor(request.cookies.get(CONSOLE_COOKIE)?.value);
  if (!visitor || fromAnotherSite(request)) {
    return Response.json(
      { error: 'missing API key: send it as "Authorization: Bearer sk_..."' },
      { status: 401 },
    );
  }

  const write = request.method !== 'GET' && request.method !== 'HEAD';
  const limited =
    throttle(LIMITS.visitor, visitor, 'too many requests; slow down') ??
    throttle(LIMITS.network, client, 'too many requests from this network; slow down') ??
    (write ? throttle(LIMITS.watchlistWrite, client, 'too many watchlist changes; try again later') : null);

  return limited ?? passThrough(request);
}

/**
 * Whether the browser says this came from a page on another site. Browsers
 * send Sec-Fetch-Site over https and on localhost; when it is missing (plain
 * http) the cookie's SameSite=Lax is what keeps other sites out.
 */
function fromAnotherSite(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site');
  return site !== null && site !== 'same-origin' && site !== 'none';
}

/** A 429 if this client is over the limit, or null to carry on. */
function throttle(limiter: RateLimiter, client: string, error: string): Response | null {
  const verdict = limiter.hit(client);
  if (verdict.ok) return null;

  return Response.json(
    { error },
    { status: 429, headers: { 'Retry-After': String(verdict.retryAfter) } },
  );
}

/**
 * Lets a request through with the billing header removed, so nobody can name
 * a customer for a route to refund. Only `admitKey` sets it.
 */
function passThrough(request: NextRequest, billed?: number, headers?: Record<string, string>) {
  const forwarded = new Headers(request.headers);
  forwarded.delete(BILLED_CUSTOMER_HEADER);
  if (billed !== undefined) forwarded.set(BILLED_CUSTOMER_HEADER, String(billed));

  return NextResponse.next({ request: { headers: forwarded }, headers });
}

/**
 * This site as the browser reached it. request.url is built from the address
 * the server is bound to (0.0.0.0 in Docker), so a redirect made from it sends
 * people somewhere they cannot reach. PUBLIC_URL wins when it is set; otherwise
 * it is rebuilt from the Host header, or a TLS proxy's forwarded one.
 */
function publicOrigin(request: NextRequest): string {
  if (PUBLIC_URL) return PUBLIC_URL;

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host;
  return `${isHttps(request) ? 'https' : 'http'}://${host}`;
}

/**
 * Every page but /admin is public. Serving one also hands the browser the
 * console cookie -- a random id for this browser, signed by this server --
 * which is what lets that page's own /api/* calls through without a key, and
 * what the watchlist records as the owner of an entry.
 *
 * Anyone can still get one by loading a page, so it is not a lock: what it
 * does is tie every keyless call to one browser, whose pace is then capped.
 * Paying for a key is the way past that.
 */
function openPage(request: NextRequest): NextResponse {
  const response = passThrough(request);

  if (!readVisitor(request.cookies.get(CONSOLE_COOKIE)?.value)) {
    response.cookies.set(CONSOLE_COOKIE, newVisitorCookie(), {
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
  // Keys are for reading chain data. The watchlist is the console's: it
  // decides what the indexer subscribes to, and lists what visitors watch.
  if (request.nextUrl.pathname === '/api/watchlist') {
    return Response.json({ error: 'the watchlist is not part of the API' }, { status: 403 });
  }
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

    // Counted now, so the quota holds under concurrency; the route hands the
    // request back if it does not answer with data (see refundRequest).
    return passThrough(request, customerId, headers);
  } catch (err) {
    log.error('key check failed', { error: errorMessage(err) });
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}

export const config = {
  // Everything but build assets and the files in public/.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)'],
};
