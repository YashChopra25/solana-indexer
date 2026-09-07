import { describe, expect, it } from 'vitest';
import { ASSET_LABEL_CH, assetLabel, formatValue, truncate } from '../../src/lib/format';

const NATIVE_SOL = 'So11111111111111111111111111111111111111111';
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('assetLabel', () => {
  it('uses a symbol when the token list knows one', () => {
    expect(assetLabel(USDC, 'USDC')).toBe('USDC');
  });

  it('falls back to a shortened mint when it does not', () => {
    expect(assetLabel(USDC, null)).toBe('EPjF…Dt1v');
    expect(assetLabel(USDC)).toBe('EPjF…Dt1v');
  });

  it('treats an empty symbol as no symbol', () => {
    expect(assetLabel(USDC, '')).toBe('EPjF…Dt1v');
  });

  /**
   * The important one. Every token list calls the wrapped-SOL mint "SOL", so
   * letting a symbol win here would make a wrap indistinguishable from a trade
   * — which is the exact distinction `extract/swaps.ts` is built around.
   */
  it('never lets a symbol collapse wrapped SOL into native SOL', () => {
    expect(assetLabel(WRAPPED_SOL, 'SOL')).toBe('wSOL');
    expect(assetLabel(NATIVE_SOL, 'SOL')).toBe('SOL');
    expect(assetLabel(WRAPPED_SOL, 'SOL')).not.toBe(assetLabel(NATIVE_SOL, 'SOL'));
  });

  it('keeps the sentinels even when a list offers something else entirely', () => {
    expect(assetLabel(NATIVE_SOL, 'NOTSOL')).toBe('SOL');
    expect(assetLabel(WRAPPED_SOL, 'NOTSOL')).toBe('wSOL');
  });

  /**
   * The console reserves a fixed slot for the label so a feed that repaints
   * every couple of seconds never shifts its columns sideways. That only works
   * while the fallback really is the width the slot was sized for.
   */
  it('renders an unnamed mint at exactly the reserved width', () => {
    expect(truncate(USDC, 4, 4)).toHaveLength(ASSET_LABEL_CH);
    expect(assetLabel(USDC, null)).toHaveLength(ASSET_LABEL_CH);
  });
});

describe('formatValue', () => {
  it('scales by decimals and names the asset', () => {
    expect(formatValue({ mint: USDC, amount: '1500000', decimals: 6, symbol: 'USDC' })).toBe(
      '1.5 USDC',
    );
  });

  it('shows a shortened mint when the asset has no symbol', () => {
    expect(formatValue({ mint: USDC, amount: '1500000', decimals: 6, symbol: null })).toBe(
      '1.5 EPjF…Dt1v',
    );
  });

  it('keeps u64 precision that a JavaScript number would round away', () => {
    expect(
      formatValue({ mint: USDC, amount: '18446744073709551615', decimals: 0, symbol: 'USDC' }),
    ).toBe('18,446,744,073,709,551,615 USDC');
  });

  it('has something to show for a row with no amount', () => {
    expect(formatValue(null)).toBe('—');
  });
});
