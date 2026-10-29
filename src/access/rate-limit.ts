/**
 * Requests per client per time window, counted in this process's memory.
 *
 * The console is public, so without this one script could poll the API as
 * fast as it likes and take Postgres with it. In memory is enough for the one
 * web container this project runs; a second replica would need a shared store
 * such as Redis, and each replica would otherwise allow the full limit.
 */

export interface Limit {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
}

export interface Verdict {
  ok: boolean;
  remaining: number;
  /** Seconds until the window resets; what Retry-After should say. */
  retryAfter: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Above this many tracked clients, expired buckets are swept (at most once a second). */
const SWEEP_AT = 10_000;

/**
 * Hard ceiling on tracked clients. A flood of made-up identities (random keys,
 * spoofed cookies) could otherwise grow the map without end; past this the
 * oldest buckets are dropped, which at worst forgets a quiet client's count.
 */
const MAX_CLIENTS = 50_000;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private sweptAt = 0;

  constructor(private readonly limit: Limit) {}

  hit(client: string, now = Date.now()): Verdict {
    if (this.buckets.size > SWEEP_AT && now - this.sweptAt >= 1_000) this.sweep(now);

    let bucket = this.buckets.get(client);
    if (!bucket || bucket.resetAt <= now) {
      // Re-inserted, so the map stays in order of when each window started --
      // oldest first, which is what eviction relies on.
      this.buckets.delete(client);
      bucket = { count: 0, resetAt: now + this.limit.windowMs };
      this.buckets.set(client, bucket);
      this.evict();
    }

    bucket.count++;

    return {
      ok: bucket.count <= this.limit.max,
      remaining: Math.max(0, this.limit.max - bucket.count),
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  get size(): number {
    return this.buckets.size;
  }

  private sweep(now: number): void {
    this.sweptAt = now;
    for (const [client, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(client);
    }
  }

  private evict(): void {
    for (const client of this.buckets.keys()) {
      if (this.buckets.size <= MAX_CLIENTS) return;
      this.buckets.delete(client);
    }
  }
}

/**
 * Who is asking, as far as the server can tell.
 *
 * In production the app sits behind Caddy, which appends the address it saw
 * to X-Forwarded-For -- so the last entry is the one a client cannot forge.
 * Earlier entries are whatever the client sent and are ignored.
 */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }

  return headers.get('x-real-ip') ?? 'unknown';
}
