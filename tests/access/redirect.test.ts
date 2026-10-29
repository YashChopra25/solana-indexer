import { describe, expect, it } from 'vitest';
import { safeNext } from '../../src/access/redirect';

describe('safeNext', () => {
  it('keeps paths on this site', () => {
    expect(safeNext('/admin')).toBe('/admin');
    expect(safeNext('/wallets/abc?x=1#y')).toBe('/wallets/abc?x=1#y');
  });

  it('refuses anything a browser would take off-site', () => {
    for (const next of ['//evil.com', '/\\evil.com', '/\\/evil.com', 'https://evil.com', 'evil.com', '/\tevil', '']) {
      expect(safeNext(next), next).toBe('/admin');
    }
  });
});
