import { refundIfBilled } from '@/access/billing';

export const dynamic = 'force-dynamic';

/**
 * Any /api/* path with no route of its own: a JSON 404 rather than the
 * console's HTML page, so a client that typed a path wrong gets an answer it
 * can parse. It costs a keyed caller nothing.
 */
async function notFound(request: Request): Promise<Response> {
  await refundIfBilled();
  const { pathname } = new URL(request.url);
  return Response.json({ error: `no such endpoint: ${pathname}; see /docs` }, { status: 404 });
}

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE };
