import { SESSION_COOKIE } from '@/access/session';

export const dynamic = 'force-dynamic';

/** POST /api/logout — clears the session cookie and returns to the login page. */
export async function POST(request: Request) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL('/login', request.url).toString(),
      'Set-Cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    },
  });
}
