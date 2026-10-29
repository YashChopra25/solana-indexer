import { SESSION_COOKIE, SESSION_TTL_SECONDS, isHttps, safeEqual, signSession } from '@/access/session';
import { ADMIN_PASSWORD } from '@/config';
import { safeNext } from '@/access/redirect';

export const dynamic = 'force-dynamic';

/**
 * POST /api/login — the login form posts here. A plain form post rather than a
 * fetch, so signing in works before any JavaScript has loaded.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get('password') ?? '');
  const next = safeNext(String(form.get('next') ?? '/admin'));

  if (!ADMIN_PASSWORD || !safeEqual(password, ADMIN_PASSWORD)) {
    const retry = new URLSearchParams({ error: ADMIN_PASSWORD ? 'wrong' : 'unset', next });
    return redirect(`/login?${retry}`);
  }

  const cookie = [
    `${SESSION_COOKIE}=${signSession(ADMIN_PASSWORD)}`,
    'Path=/',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
    // Over plain http a Secure cookie would never be sent back.
    ...(isHttps(request) ? ['Secure'] : []),
  ].join('; ');

  return redirect(next, { 'Set-Cookie': cookie });
}

/**
 * A 303 to a path on this site. The Location is relative on purpose:
 * request.url carries the address the server is bound to (0.0.0.0 in Docker),
 * not the one the browser used. Built by hand because Response.redirect wants
 * an absolute URL and its headers are immutable.
 */
function redirect(path: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { Location: path, ...headers } });
}
