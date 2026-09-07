import { describe, expect, it } from 'vitest';
import {
  BadRequestError,
  assertAddress,
  assertDiscriminator,
  assertOneOf,
  assertSignature,
  paginate,
  parsePage,
} from '../../src/server/http';
import { address, signature } from '../fixtures/build';

describe('parsePage', () => {
  const page = (query: string) => parsePage(new URLSearchParams(query));

  it('applies defaults when nothing is supplied', () => {
    expect(page('')).toEqual({ limit: 25, offset: 0 });
  });

  it('reads limit and offset', () => {
    expect(page('limit=10&offset=40')).toEqual({ limit: 10, offset: 40 });
  });

  it('clamps limit to the maximum', () => {
    expect(page('limit=5000').limit).toBe(100);
  });

  it('rejects a non-integer limit', () => {
    expect(() => page('limit=1e3')).toThrow(BadRequestError);
    expect(() => page('limit=abc')).toThrow(BadRequestError);
  });

  it('rejects a zero limit', () => {
    expect(() => page('limit=0')).toThrow(BadRequestError);
  });
});

describe('paginate', () => {
  it('reports hasMore and trims the probe row', () => {
    const rows = [1, 2, 3, 4];
    const result = paginate(rows, { limit: 3, offset: 0 });

    expect(result.data).toEqual([1, 2, 3]);
    expect(result.pagination).toMatchObject({ count: 3, hasMore: true });
  });

  it('reports hasMore false on a short page', () => {
    const result = paginate([1, 2], { limit: 3, offset: 0 });

    expect(result.pagination).toMatchObject({ count: 2, hasMore: false });
  });
});

describe('validation', () => {
  it('accepts a 32-byte address and a 64-byte signature', () => {
    expect(assertAddress(address('wallet'))).toBe(address('wallet'));
    expect(assertSignature(signature('sig'))).toBe(signature('sig'));
  });

  it('rejects each where the other is expected', () => {
    expect(() => assertAddress(signature('sig'))).toThrow(BadRequestError);
    expect(() => assertSignature(address('wallet'))).toThrow(BadRequestError);
  });

  it('rejects non-base58 input', () => {
    expect(() => assertAddress('not valid!')).toThrow(BadRequestError);
  });

  it('accepts a 16-character hex discriminator and lowercases it', () => {
    expect(assertDiscriminator('0102030405060708')).toBe('0102030405060708');
    expect(assertDiscriminator('AABBCCDDEEFF0011')).toBe('aabbccddeeff0011');
  });

  it('rejects a discriminator of the wrong length or alphabet', () => {
    expect(() => assertDiscriminator('0102')).toThrow(BadRequestError);
    expect(() => assertDiscriminator('zzzzzzzzzzzzzzzz')).toThrow(BadRequestError);
  });

  it('accepts an allowed value and rejects anything else', () => {
    expect(assertOneOf('sol', ['sol', 'spl'] as const, 'kind')).toBe('sol');
    expect(() => assertOneOf('eth', ['sol', 'spl'] as const, 'kind')).toThrow(BadRequestError);
  });
});
