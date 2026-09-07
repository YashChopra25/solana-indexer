import { describe, expect, it } from 'vitest';
import { extractInvocations } from '../../src/extract/logs';

const A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const B = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

describe('extractInvocations', () => {
  it('turns one call into one invocation with its logs', () => {
    const invocations = extractInvocations([
      `Program ${A} invoke [1]`,
      'Program log: instruction: Swap',
      `Program ${A} consumed 1234 of 200000 compute units`,
      `Program ${A} success`,
    ]);

    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      invocationIndex: 0,
      programId: A,
      depth: 1,
      parentIndex: null,
      success: true,
      computeUnits: 1234,
      logs: ['Program log: instruction: Swap'],
    });
  });

  it('nests a CPI under the program that made it', () => {
    const invocations = extractInvocations([
      `Program ${A} invoke [1]`,
      'Program log: outer',
      `Program ${B} invoke [2]`,
      'Program log: inner',
      `Program ${B} success`,
      `Program ${A} success`,
    ]);

    expect(invocations).toHaveLength(2);
    expect(invocations[1]).toMatchObject({ programId: B, depth: 2, parentIndex: 0 });
    // Each log line belongs to whichever program was running when it printed.
    expect(invocations[0].logs).toEqual(['Program log: outer']);
    expect(invocations[1].logs).toEqual(['Program log: inner']);
  });

  it('records a failed call and keeps the reason', () => {
    const [invocation] = extractInvocations([
      `Program ${A} invoke [1]`,
      `Program ${A} failed: custom program error: 0x1`,
    ]);

    expect(invocation.success).toBe(false);
    expect(invocation.logs).toContain(`Program ${A} failed: custom program error: 0x1`);
  });

  it('keeps an invocation the log was truncated before closing', () => {
    // The runtime caps log output, so the closing line can simply be missing.
    const invocations = extractInvocations([
      `Program ${A} invoke [1]`,
      'Program log: cut off here',
    ]);

    expect(invocations).toHaveLength(1);
    expect(invocations[0].success).toBe(false);
    expect(invocations[0].logs).toEqual(['Program log: cut off here']);
  });

  it('drops runtime lines printed before any program started', () => {
    const invocations = extractInvocations([
      'Program log: orphan',
      `Program ${A} invoke [1]`,
      `Program ${A} success`,
    ]);

    expect(invocations).toHaveLength(1);
    expect(invocations[0].logs).toEqual([]);
  });

  it('handles two calls in sequence at the top level', () => {
    const invocations = extractInvocations([
      `Program ${A} invoke [1]`,
      `Program ${A} success`,
      `Program ${B} invoke [1]`,
      `Program ${B} success`,
    ]);

    expect(invocations.map((i) => i.programId)).toEqual([A, B]);
    expect(invocations.every((i) => i.parentIndex === null)).toBe(true);
  });

  it('returns nothing for an empty log', () => {
    expect(extractInvocations([])).toEqual([]);
  });
});
