import { describe, expect, it, vi } from 'vitest';
import { shared } from '../../src/server/cache';

describe('shared', () => {
  it('runs a load once for everyone asking within the window', async () => {
    const load = vi.fn(async () => 42);

    const [a, b] = await Promise.all([shared('k1', 1_000, load), shared('k1', 1_000, load)]);

    expect([a, b]).toEqual([42, 42]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not remember a failure', async () => {
    let calls = 0;
    const load = async () => {
      calls++;
      if (calls === 1) throw new Error('down');
      return 'up';
    };

    await expect(shared('k2', 60_000, load)).rejects.toThrow('down');
    await Promise.resolve();
    expect(await shared('k2', 60_000, load)).toBe('up');
  });
});
