import { describe, expect, it } from 'vitest';
import { clientAddress, RateLimiter } from '../../src/access/rate-limit';

describe('RateLimiter', () => {
  it('allows up to the limit in a window, then refuses with a retry time', () => {
    const limiter = new RateLimiter({ max: 2, windowMs: 60_000 });

    expect(limiter.hit('a', 0).ok).toBe(true);
    expect(limiter.hit('a', 1).ok).toBe(true);

    const third = limiter.hit('a', 30_000);
    expect(third).toMatchObject({ ok: false, remaining: 0, retryAfter: 30 });
  });

  it('counts each client separately and starts over when the window ends', () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 1_000 });

    expect(limiter.hit('a', 0).ok).toBe(true);
    expect(limiter.hit('b', 0).ok).toBe(true);
    expect(limiter.hit('a', 500).ok).toBe(false);
    expect(limiter.hit('a', 1_000).ok).toBe(true);
  });
});

describe('RateLimiter memory', () => {
  it('never tracks more than its ceiling, however many identities appear', () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 60_000 });
    for (let i = 0; i < 60_000; i++) limiter.hit(`fake-${i}`, 0);

    expect(limiter.size).toBeLessThanOrEqual(50_000);
    // The newest clients are the ones kept.
    expect(limiter.hit('fake-59999', 1).ok).toBe(false);
  });
});

describe('clientAddress', () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it('takes the last X-Forwarded-For hop, which the proxy in front added', () => {
    expect(clientAddress(headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('falls back to X-Real-IP, then to one shared bucket', () => {
    expect(clientAddress(headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientAddress(headers({}))).toBe('unknown');
  });
});
