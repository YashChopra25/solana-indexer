import { createHmac, timingSafeEqual } from 'node:crypto';
import { ADMIN_PASSWORD, IS_PRODUCTION } from '../config';

/**
 * The operator's login for the console.
 *
 * There is one admin and one password, ADMIN_PASSWORD. Logging in sets a cookie
 * holding an expiry time and an HMAC of it, keyed by the password. Nothing is
 * stored server-side: the cookie is valid if its signature checks out and it
 * has not expired. Changing the password signs everyone out.
 */

export const SESSION_COOKIE = 'admin_session';

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Whether a request carrying this cookie is the operator. Asked by the proxy
 * for every page, and again by each /admin action -- a server action is a POST
 * to whatever page uses it, so it should not lean on the proxy alone.
 */
export function isAdminSession(cookie: string | undefined): boolean {
  if (!ADMIN_PASSWORD) return !IS_PRODUCTION;
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

/** Compares in constant time, so the response time leaks nothing. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sign(password: string, value: string): string {
  return createHmac('sha256', password).update(value).digest('base64url');
}
