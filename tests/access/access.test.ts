import { describe, expect, it } from 'vitest';
import { checkKey, generateKey, hashKey, readKey, type KeyRecord } from '../../src/access/keys';
import { readAmount, readCurrency, readEmail, readMonths, readPlan } from '../../src/access/input';
import {
  isHttps,
  newVisitorCookie,
  readVisitor,
  safeEqual,
  signSession,
  verifySession,
} from '../../src/access/session';

const NOW = new Date('2026-10-07T12:00:00Z');

const paid: KeyRecord = {
  customerId: 1,
  plan: 'starter',
  revokedAt: null,
  paidUntil: new Date('2026-11-07T12:00:00Z'),
};

describe('generateKey', () => {
  it('stores a hash and a prefix of the key, never the key itself', () => {
    const { key, hash, prefix } = generateKey();

    expect(key).toMatch(/^sk_[\w-]{32}$/);
    expect(hash).toBe(hashKey(key));
    expect(hash).not.toContain(key);
    expect(key.startsWith(prefix)).toBe(true);
  });

  it('never repeats', () => {
    expect(generateKey().key).not.toBe(generateKey().key);
  });
});

describe('readKey', () => {
  const read = (authorization?: string) =>
    readKey(new Headers(authorization ? { authorization } : {}));

  it('reads a bearer key', () => {
    expect(read('Bearer sk_abc')).toBe('sk_abc');
    expect(read('bearer sk_abc')).toBe('sk_abc');
  });

  it('ignores anything that is not one of our keys', () => {
    expect(read()).toBeNull();
    expect(read('Bearer something-else')).toBeNull();
    expect(read('Basic sk_abc')).toBeNull();
  });
});

describe('checkKey', () => {
  it('admits a live key with payment covering now', () => {
    expect(checkKey(paid, NOW)).toEqual({ ok: true });
  });

  it('rejects an unknown or revoked key with 401', () => {
    expect(checkKey(null, NOW)).toMatchObject({ ok: false, status: 401 });
    expect(checkKey({ ...paid, revokedAt: NOW }, NOW)).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects an unpaid or lapsed customer with 402', () => {
    expect(checkKey({ ...paid, paidUntil: null }, NOW)).toMatchObject({ status: 402 });
    expect(checkKey({ ...paid, paidUntil: NOW }, NOW)).toMatchObject({ status: 402 });
  });

  it('rejects a plan that no longer exists rather than treating it as unlimited', () => {
    expect(checkKey({ ...paid, plan: 'enterprise' }, NOW)).toMatchObject({ status: 402 });
  });
});

describe('admin session', () => {
  const now = NOW.getTime();

  it('accepts a cookie it signed', () => {
    expect(verifySession('pw', signSession('pw', now), now)).toBe(true);
  });

  it('rejects a cookie signed with another password', () => {
    expect(verifySession('new-pw', signSession('pw', now), now)).toBe(false);
  });

  it('rejects a cookie whose expiry was edited', () => {
    const [, signature] = signSession('pw', now).split('.');
    expect(verifySession('pw', `${now + 10 ** 12}.${signature}`, now)).toBe(false);
  });

  it('rejects an expired cookie, and no cookie at all', () => {
    const later = now + 8 * 24 * 60 * 60 * 1000;
    expect(verifySession('pw', signSession('pw', now), later)).toBe(false);
    expect(verifySession('pw', undefined, now)).toBe(false);
  });
});

describe('console cookie', () => {
  it('reads back the id of a cookie this server made', () => {
    const cookie = newVisitorCookie();
    expect(readVisitor(cookie)).toBe(cookie.split('.')[0]);
  });

  it('refuses a made-up or tampered value', () => {
    const [id, signature] = newVisitorCookie().split('.');

    expect(readVisitor('A'.repeat(22))).toBeNull();
    expect(readVisitor(`${'A'.repeat(22)}.${signature}`)).toBeNull();
    expect(readVisitor(`${id}.${signature.slice(0, -1)}x`)).toBeNull();
    expect(readVisitor(undefined)).toBeNull();
  });
});

describe('safeEqual', () => {
  it('compares values of any length', () => {
    expect(safeEqual('secret', 'secret')).toBe(true);
    expect(safeEqual('secret', 'secret-but-longer')).toBe(false);
  });
});

describe('isHttps', () => {
  it('reads the scheme off the request when nothing is in front', () => {
    expect(isHttps(new Request('http://16.58.93.201:8003/'))).toBe(false);
    expect(isHttps(new Request('https://indexer.dev/'))).toBe(true);
  });

  it('trusts a TLS proxy over the scheme the server saw', () => {
    const request = new Request('http://0.0.0.0:8003/', { headers: { 'x-forwarded-proto': 'https, http' } });
    expect(isHttps(request)).toBe(true);
  });
});

describe('operator input', () => {
  it('normalises an email and rejects a malformed one', () => {
    expect(readEmail('  Ana@Acme.DEV ')).toBe('ana@acme.dev');
    expect(() => readEmail('ana@')).toThrow();
  });

  it('accepts only known plans', () => {
    expect(readPlan('pro')).toBe('pro');
    expect(() => readPlan('enterprise')).toThrow(/starter, pro/);
  });

  it('keeps amounts as exact strings, at most two decimals', () => {
    expect(readAmount('19.99')).toBe('19.99');
    expect(() => readAmount('19.999')).toThrow();
    expect(() => readAmount('-5')).toThrow();
  });

  it('takes 1 to 36 whole months', () => {
    expect(readMonths('3')).toBe(3);
    expect(() => readMonths('0')).toThrow();
    expect(() => readMonths('1.5')).toThrow();
  });

  it('defaults the currency to USD and uppercases it', () => {
    expect(readCurrency('')).toBe('USD');
    expect(readCurrency('inr')).toBe('INR');
  });
});
