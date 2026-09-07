import bs58 from 'bs58';

/**
 * Protobuf `bytes` fields reach us as Buffer or Uint8Array depending on the
 * decoder path, and occasionally as an already-encoded string. This normalizes
 * every one of those into a Uint8Array.
 */
export function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  if (typeof value === 'string') return Uint8Array.from(Buffer.from(value, 'base64'));
  if (value && typeof value === 'object' && 'data' in (value as Record<string, unknown>)) {
    // Buffer serialized as { type: 'Buffer', data: number[] }
    return Uint8Array.from((value as { data: number[] }).data);
  }
  return new Uint8Array();
}

/** Encodes protobuf bytes as a base58 address or signature. */
export function toBase58(value: unknown): string {
  if (typeof value === 'string' && !looksBase64(value)) return value;
  return bs58.encode(toBytes(value));
}

export function toBase64(value: unknown): string {
  return Buffer.from(toBytes(value)).toString('base64');
}

/**
 * Base58 excludes 0, O, I, l and never contains +, / or =. A string carrying
 * any of those is base64 from the proto decoder rather than an address.
 */
function looksBase64(value: string): boolean {
  return /[+/=]/.test(value) || /[0OIl]/.test(value);
}

/** Reads a little-endian u64 as a bigint; returns null if out of range. */
export function readU64LE(data: Uint8Array, offset: number): bigint | null {
  if (offset + 8 > data.length) return null;

  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  return view.getBigUint64(0, true);
}

/** Reads a little-endian u32; returns null if out of range. */
export function readU32LE(data: Uint8Array, offset: number): number | null {
  if (offset + 4 > data.length) return null;

  const view = new DataView(data.buffer, data.byteOffset + offset, 4);
  return view.getUint32(0, true);
}
