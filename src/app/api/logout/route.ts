import { SESSION_COOKIE } from '@/access/session';

export const dynamic = 'force-dynamic';

/** POST /api/logout — clears the session cookie and returns to the console. */
export async function POST() {
  return new Response(null, {
    status: 303,
    headers: {
      // Relative, for the reason given in the login route.
      Location: '/',
      'Set-Cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    },
  });
}
