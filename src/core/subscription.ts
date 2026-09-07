/**
 * What the stream should be filtering on at any moment.
 *
 * Two inputs: the baseline from configuration, which never changes while the
 * worker runs, and the watchlist, which a browser can change at any time.
 */

/**
 * The union of both, deduplicated and sorted.
 *
 * Sorting is not cosmetic — it is what lets `sameSet` decide in one pass
 * whether anything actually changed, so an unchanged watchlist costs nothing
 * and never rewrites the subscription.
 */
export function subscriptionSet(baseline: string[], watched: string[]): string[] {
  return [...new Set([...baseline, ...watched])].sort();
}

/** True when two sorted sets hold the same addresses. */
export function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((address, i) => address === b[i]);
}

/**
 * A watch target flattened to one comparable string, so a list of them can be
 * diffed with `sameSet` without a second comparison function.
 */
export function targetKey(target: { kind: string; address: string }): string {
  return `${target.kind}:${target.address}`;
}

/**
 * Whether watching something can actually change what gets ingested.
 *
 * An empty baseline means "every non-vote transaction", so the stream already
 * carries everything and a watch narrows nothing. Worth saying out loud once at
 * startup, because the alternative is someone adding a program and quietly
 * wondering why the numbers do not move.
 */
export function watchingAffectsIngestion(baseline: string[]): boolean {
  return baseline.length > 0;
}
