/**
 * Answers shared between callers for a moment.
 *
 * Every open console polls the same few endpoints, so a hundred viewers would
 * otherwise mean a hundred identical queries a second. Holding one answer for a
 * second or two -- and sharing a query already in flight -- makes the database
 * cost of the console flat in the number of people looking at it.
 */

interface Entry {
  value: Promise<unknown>;
  expiresAt: number;
}

const entries = new Map<string, Entry>();

/** Past this many keys, expired ones are swept before adding another. */
const SWEEP_AT = 1_000;

export function shared<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.expiresAt > now) return hit.value as Promise<T>;

  if (entries.size > SWEEP_AT) {
    for (const [k, entry] of entries) if (entry.expiresAt <= now) entries.delete(k);
  }

  const value = load();
  entries.set(key, { value, expiresAt: now + ttlMs });
  // A failure is not worth remembering: the next caller should try again.
  value.catch(() => entries.delete(key));

  return value;
}
