import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ADMIN_PASSWORD, APP_SECRET } from '../config';

/**
 * The operator's login for the console.
 *
 * There is one admin and one password, ADMIN_PASSWORD. Logging in sets a cookie
 * holding an expiry time and an HMAC of it, keyed by the password. Nothing is
 * stored server-side: the cookie is valid if its signature checks out and it
 * has not expired. Changing the password signs everyone out.
 */

export const SESSION_COOKIE = 'admin_session';

/**
 * Set on anyone who opens a console page; lets that page call /api/* without a
 * key. Its value is a random id for this browser plus a signature, so the
 * watchlist can tell whose entry is whose without anyone signing in -- and so
 * nobody can skip the page and simply make one up.
 */
export const CONSOLE_COOKIE = 'console';

/**
 * What console cookies are signed with. APP_SECRET if set; otherwise derived
 * from the admin password; otherwise random, which is fine for development but
 * signs every visitor out whenever the server restarts.
 */
const CONSOLE_SECRET =
  APP_SECRET ??
  (ADMIN_PASSWORD ? sign(ADMIN_PASSWORD, 'console-cookie') : randomBytes(32).toString('base64url'));

/** A fresh `id.signature` value for the console cookie. */
export function newVisitorCookie(): string {
  const id = randomBytes(16).toString('base64url');
  return `${id}.${sign(CONSOLE_SECRET, id)}`;
}

/** The visitor id in a console cookie, or null unless this server signed it. */
export function readVisitor(cookie: string | undefined): string | null {
  if (!cookie) return null;

  const [id, signature] = cookie.split('.');
  if (!id || !signature || !/^[A-Za-z0-9_-]{22}$/.test(id)) return null;

  return safeEqual(signature, sign(CONSOLE_SECRET, id)) ? id : null;
}

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Whether a request carrying this cookie is the operator. Asked by the proxy
 * for every page, and again by /admin itself and each of its actions -- a
 * server action is a POST to whatever page uses it, so nothing there leans on
 * the proxy alone.
 *
 * No ADMIN_PASSWORD means nobody is the operator, in development too: a dev
 * server reachable from the internet would otherwise hand out the customer
 * list to anyone.
 */
export function isAdminSession(cookie: string | undefined): boolean {
  if (!ADMIN_PASSWORD) return false;
  return verifySession(ADMIN_PASSWORD, cookie);
}

export function signSession(password: string, now = Date.now()): string {
  const expires = String(now + SESSION_TTL_SECONDS * 1000);
  return `${expires}.${sign(password, expires)}`;
}

export function verifySession(password: string, cookie: string | undefined, now = Date.now()): boolean {
  if (!cookie) return false;

  const [expires, signature] = cookie.split('.');
  if (!expires || !signature || Number(expires) <= now) return false;

  return safeEqual(signature, sign(password, expires));
}

/**
 * Compares in constant time, so the response time leaks nothing -- not even
 * the length, since both sides are hashed to the same size first.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

/**
 * Whether the browser reached us over https, so cookies can be marked Secure.
 * Asked of the request rather than NODE_ENV: a production server on plain
 * http would otherwise set Secure cookies the browser never sends back, and
 * signing in would quietly fail. Behind a TLS proxy, x-forwarded-proto says so.
 */
export function isHttps(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
  return (forwarded ?? new URL(request.url).protocol.replace(':', '')) === 'https';
}

function sign(password: string, value: string): string {
  return createHmac('sha256', password).update(value).digest('base64url');
}
