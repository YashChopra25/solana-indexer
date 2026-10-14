import { SESSION_COOKIE, SESSION_TTL_SECONDS, safeEqual, signSession } from '@/access/session';
import { ADMIN_PASSWORD, IS_PRODUCTION } from '@/config';

export const dynamic = 'force-dynamic';

/**
 * POST /api/login — the login form posts here. A plain form post rather than a
 * fetch, so signing in works before any JavaScript has loaded.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get('password') ?? '');
  const next = safeNext(String(form.get('next') ?? '/'));

  if (!ADMIN_PASSWORD || !safeEqual(password, ADMIN_PASSWORD)) {
    const retry = new URL('/login', request.url);
    retry.searchParams.set('error', ADMIN_PASSWORD ? 'wrong' : 'unset');
    retry.searchParams.set('next', next);
    return Response.redirect(retry, 303);
  }

  const cookie = [
    `${SESSION_COOKIE}=${signSession(ADMIN_PASSWORD)}`,
    'Path=/',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
    // Over plain http (local dev) a Secure cookie would never be sent back.
    ...(IS_PRODUCTION ? ['Secure'] : []),
  ].join('; ');

  // Built by hand because Response.redirect's headers are immutable.
  return new Response(null, {
    status: 303,
    headers: { Location: new URL(next, request.url).toString(), 'Set-Cookie': cookie },
  });
}

/** Only a path on this site, so the form cannot be used to bounce people elsewhere. */
function safeNext(next: string): string {
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
