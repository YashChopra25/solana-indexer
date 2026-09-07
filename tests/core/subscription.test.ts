import { describe, expect, it } from 'vitest';
import { sameSet, subscriptionSet, watchingAffectsIngestion } from '../../src/core/subscription';

/**
 * The reconcile loop runs on a timer against a live gRPC stream, so the part
 * worth testing is the decision it makes: what the filter should be, and
 * whether it changed at all.
 */

describe('subscriptionSet', () => {
  it('unions the configured baseline with the watchlist', () => {
    expect(subscriptionSet(['a'], ['b'])).toEqual(['a', 'b']);
  });

  it('deduplicates an address that is both configured and watched', () => {
    expect(subscriptionSet(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('sorts, so two equal sets built in different orders compare equal', () => {
    expect(subscriptionSet(['c', 'a'], ['b'])).toEqual(subscriptionSet(['b', 'c'], ['a']));
  });

  it('handles an empty baseline and an empty watchlist', () => {
    expect(subscriptionSet([], [])).toEqual([]);
    expect(subscriptionSet([], ['a'])).toEqual(['a']);
    expect(subscriptionSet(['a'], [])).toEqual(['a']);
  });
});

describe('sameSet', () => {
  it('is true for identical sorted sets', () => {
    expect(sameSet(['a', 'b'], ['a', 'b'])).toBe(true);
  });

  it('is false when something was added or removed', () => {
    expect(sameSet(['a'], ['a', 'b'])).toBe(false);
    expect(sameSet(['a', 'b'], ['a'])).toBe(false);
  });

  it('is false when one address was swapped for another', () => {
    expect(sameSet(['a', 'b'], ['a', 'c'])).toBe(false);
  });

  it('is true for two empty sets, so an empty watchlist never rewrites', () => {
    expect(sameSet([], [])).toBe(true);
  });

  it('agrees with subscriptionSet that re-adding a known address is no change', () => {
    const before = subscriptionSet(['a'], ['b']);
    const after = subscriptionSet(['a'], ['b', 'a']);

    expect(sameSet(before, after)).toBe(true);
  });
});

describe('watchingAffectsIngestion', () => {
  it('is false for an empty baseline, which already ingests everything', () => {
    expect(watchingAffectsIngestion([])).toBe(false);
  });

  it('is true once the baseline narrows anything', () => {
    expect(watchingAffectsIngestion(['a'])).toBe(true);
  });
});
