import { createHash, randomBytes } from 'node:crypto';
import { isPlan } from './plans';

/**
 * API keys: making them, recognising them, and deciding whether one may be
 * used right now. All pure -- the database half is in src/store/access.ts.
 */

const KEY_PREFIX = 'sk_';

/** How much of a key is kept in the clear, so listings can tell keys apart. */
const VISIBLE_CHARS = 10;

export interface NewKey {
  /** Shown to the operator once, and never stored. */
  key: string;
  hash: string;
  prefix: string;
}

export function generateKey(): NewKey {
  const key = `${KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
  return { key, hash: hashKey(key), prefix: key.slice(0, VISIBLE_CHARS) };
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * The key a request carries, from `Authorization: Bearer sk_...`, or null.
 *
 * Only the header, never the query string: URLs end up in access logs and
 * browser history, and a key there would leak with them.
 */
export function readKey(headers: Headers): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(headers.get('authorization') ?? '');
  return match && match[1].startsWith(KEY_PREFIX) ? match[1] : null;
}

/** What the database knows about a key, joined with its customer. */
export interface KeyRecord {
  customerId: number;
  plan: string;
  revokedAt: Date | null;
  /** The latest `covers_until` across the customer's payments. */
  paidUntil: Date | null;
}

export type Verdict =
  | { ok: true }
  | { ok: false; status: 401 | 402; error: string };

/**
 * Everything about a key except its quota. The quota is checked by the same
 * statement that counts the request, so two requests racing for the last one
 * cannot both get it.
 */
export function checkKey(record: KeyRecord | null, now: Date): Verdict {
  if (!record || record.revokedAt) {
    return { ok: false, status: 401, error: 'invalid or revoked API key' };
  }

  if (!record.paidUntil || record.paidUntil <= now) {
    return { ok: false, status: 402, error: 'no active subscription: payment has lapsed or was never recorded' };
  }

  // A plan removed from the code would otherwise read as unlimited.
  if (!isPlan(record.plan)) {
    return { ok: false, status: 402, error: `unknown plan "${record.plan}"` };
  }

  return { ok: true };
}
