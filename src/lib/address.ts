import bs58 from 'bs58';

/**
 * Whether a string is a Solana address: base58 for 32 bytes. The same rule
 * the API applies, checked in the browser so a mistyped URL gets an
 * explanation instead of a page polling an endpoint that will only say 400.
 */
export function isAddress(value: string): boolean {
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}
