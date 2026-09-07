import { describe, expect, it } from 'vitest';
import { clean } from '../../src/chain/token-list';

/**
 * A symbol is whatever the person who minted the token decided to call it, so
 * these are the cases where a name is trying to be something other than a name.
 *
 * Every hostile input is written as an escape rather than as itself: a test
 * that pasted the real character in would be a test nobody could read, which is
 * the same property that makes the character worth stripping.
 */
describe('clean', () => {
  it('keeps an ordinary symbol as it is', () => {
    expect(clean('USDC', 12)).toBe('USDC');
  });

  it('strips zero-width characters used to impersonate another token', () => {
    // Renders identically to 'USDC' but is a different string, so without this
    // the console would show two tokens a reader cannot tell apart.
    expect(clean('US\u200bDC', 12)).toBe('USDC');
    expect(clean('\ufeffBONK', 12)).toBe('BONK');
  });

  it('strips bidi overrides, which reorder the text around them', () => {
    expect(clean('\u202eUSDC', 12)).toBe('USDC');
    expect(clean('a\u202db\u202cc', 12)).toBe('abc');
    expect(clean('\u2066SOL\u2069', 12)).toBe('SOL');
  });

  it('strips control characters', () => {
    expect(clean('US\u0000DC', 12)).toBe('USDC');
    expect(clean('USDC\u007f', 12)).toBe('USDC');
  });

  it('collapses whitespace that would break a table row', () => {
    expect(clean('  Wrapped\n\tSOL  ', 40)).toBe('Wrapped SOL');
  });

  it('caps a symbol that is not really a symbol', () => {
    expect(clean('X'.repeat(200), 12)).toBe('X'.repeat(12));
  });

  it('returns null when nothing usable survives', () => {
    expect(clean('\u200b\u200b', 12)).toBeNull();
    expect(clean('   ', 12)).toBeNull();
    expect(clean('', 12)).toBeNull();
  });

  it('returns null for anything that is not a string', () => {
    expect(clean(undefined, 12)).toBeNull();
    expect(clean(null, 12)).toBeNull();
    expect(clean(42, 12)).toBeNull();
    expect(clean({ symbol: 'USDC' }, 12)).toBeNull();
  });
});
