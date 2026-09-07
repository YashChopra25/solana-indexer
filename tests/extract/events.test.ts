import { describe, expect, it } from 'vitest';
import { extractEvents } from '../../src/extract/events';
import { extractInvocations } from '../../src/extract/logs';
import { flattenAccountKeys } from '../../src/extract/accounts';
import { address, buildTransaction, eventCpiData, instruction } from '../fixtures/build';

const PROGRAM = address('anchor-program');
const DISCRIMINATOR = '0102030405060708';

/** `Program data:` carries base64; this builds a payload with a known type. */
function logPayload(discriminator: string, bodyBytes = 8): string {
  return Buffer.concat([Buffer.from(discriminator, 'hex'), Buffer.alloc(bodyBytes)]).toString(
    'base64',
  );
}

function eventsOf(tx: ReturnType<typeof buildTransaction>) {
  const keys = flattenAccountKeys(tx);

  return extractEvents(tx, keys, extractInvocations(tx.logs));
}

describe('events emitted through the logs', () => {
  it('reads a Program data: line as an event of the running program', () => {
    const tx = buildTransaction({
      accountKeys: [address('payer'), PROGRAM],
      logs: [
        `Program ${PROGRAM} invoke [1]`,
        `Program data: ${logPayload(DISCRIMINATOR)}`,
        `Program ${PROGRAM} success`,
      ],
    });

    const [event] = eventsOf(tx);

    expect(event.programId).toBe(PROGRAM);
    expect(event.source).toBe('log');
    expect(event.discriminator).toBe(DISCRIMINATOR);
  });

  it('attributes an event to the inner program that printed it', () => {
    const inner = address('inner-program');

    const tx = buildTransaction({
      accountKeys: [address('payer'), PROGRAM, inner],
      logs: [
        `Program ${PROGRAM} invoke [1]`,
        `Program ${inner} invoke [2]`,
        `Program data: ${logPayload(DISCRIMINATOR)}`,
        `Program ${inner} success`,
        `Program ${PROGRAM} success`,
      ],
    });

    expect(eventsOf(tx)[0].programId).toBe(inner);
  });

  it('ignores an ordinary log line', () => {
    const tx = buildTransaction({
      accountKeys: [address('payer'), PROGRAM],
      logs: [
        `Program ${PROGRAM} invoke [1]`,
        'Program log: just a message',
        `Program ${PROGRAM} success`,
      ],
    });

    expect(eventsOf(tx)).toEqual([]);
  });

  it('ignores a payload too short to hold a discriminator', () => {
    const tx = buildTransaction({
      accountKeys: [address('payer'), PROGRAM],
      logs: [
        `Program ${PROGRAM} invoke [1]`,
        `Program data: ${Buffer.alloc(4).toString('base64')}`,
        `Program ${PROGRAM} success`,
      ],
    });

    expect(eventsOf(tx)).toEqual([]);
  });
});

describe('events emitted as a self-CPI', () => {
  it('reads the discriminator from behind the event marker', () => {
    const tx = buildTransaction({
      accountKeys: [address('payer'), PROGRAM],
      instructions: [instruction(1, [0], eventCpiData(DISCRIMINATOR))],
    });

    const [event] = eventsOf(tx);

    expect(event.source).toBe('cpi');
    expect(event.programId).toBe(PROGRAM);
    expect(event.discriminator).toBe(DISCRIMINATOR);
  });

  it('finds one invoked through an inner instruction', () => {
    const tx = buildTransaction({
      accountKeys: [address('payer'), PROGRAM],
      instructions: [instruction(1, [0], new Uint8Array([1, 2, 3]))],
      innerInstructions: [
        { index: 0, instructions: [instruction(1, [0], eventCpiData(DISCRIMINATOR))] },
      ],
    });

    expect(eventsOf(tx)).toHaveLength(1);
  });

  it('ignores an ordinary instruction that merely looks long enough', () => {
    const tx = buildTransaction({
      accountKeys: [address('payer'), PROGRAM],
      instructions: [instruction(1, [0], new Uint8Array(32))],
    });

    expect(eventsOf(tx)).toEqual([]);
  });
});

describe('both kinds together', () => {
  it('numbers every event uniquely, CPI events first', () => {
    const tx = buildTransaction({
      accountKeys: [address('payer'), PROGRAM],
      instructions: [instruction(1, [0], eventCpiData(DISCRIMINATOR))],
      logs: [
        `Program ${PROGRAM} invoke [1]`,
        `Program data: ${logPayload('aabbccddeeff0011')}`,
        `Program ${PROGRAM} success`,
      ],
    });

    const events = eventsOf(tx);

    expect(events.map((e) => e.eventIndex)).toEqual([0, 1]);
    expect(events.map((e) => e.source)).toEqual(['cpi', 'log']);
  });
});

/**
 * `emit_cpi!` puts the same bytes in both places. Real programs do this on
 * every event, so without deduplication every per-program total doubles.
 */
describe('an event that arrives as both a CPI and a log', () => {
  /** The exact payload the self-CPI carries, as the log line would encode it. */
  function sameBytesAsCpi(discriminator: string): string {
    return Buffer.from(eventCpiData(discriminator)).subarray(8).toString('base64');
  }

  it('is counted once, keeping the CPI copy', () => {
    const tx = buildTransaction({
      accountKeys: [address('payer'), PROGRAM],
      instructions: [instruction(1, [0], eventCpiData(DISCRIMINATOR))],
      logs: [
        `Program ${PROGRAM} invoke [1]`,
        `Program data: ${sameBytesAsCpi(DISCRIMINATOR)}`,
        `Program ${PROGRAM} success`,
      ],
    });

    const events = eventsOf(tx);

    expect(events).toHaveLength(1);
    // The CPI copy survives log truncation, so it is the one worth keeping.
    expect(events[0].source).toBe('cpi');
    expect(events[0].discriminator).toBe(DISCRIMINATOR);
  });

  it('keeps two when the program really emitted the same event twice', () => {
    const tx = buildTransaction({
      accountKeys: [address('payer'), PROGRAM],
      instructions: [
        instruction(1, [0], eventCpiData(DISCRIMINATOR)),
        instruction(1, [0], eventCpiData(DISCRIMINATOR)),
      ],
      logs: [
        `Program ${PROGRAM} invoke [1]`,
        `Program data: ${sameBytesAsCpi(DISCRIMINATOR)}`,
        `Program data: ${sameBytesAsCpi(DISCRIMINATOR)}`,
        `Program ${PROGRAM} success`,
      ],
    });

    // Two CPI events and two matching logs pair off into two, not one or four.
    expect(eventsOf(tx)).toHaveLength(2);
  });

  it('keeps a log-only event, which is what plain emit! produces', () => {
    const tx = buildTransaction({
      accountKeys: [address('payer'), PROGRAM],
      instructions: [instruction(1, [0], eventCpiData(DISCRIMINATOR))],
      logs: [
        `Program ${PROGRAM} invoke [1]`,
        `Program data: ${sameBytesAsCpi(DISCRIMINATOR)}`,
        `Program data: ${logPayload('aabbccddeeff0011')}`,
        `Program ${PROGRAM} success`,
      ],
    });

    const events = eventsOf(tx);

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.source).sort()).toEqual(['cpi', 'log']);
  });

  it('leaves eventIndex dense after dropping a duplicate', () => {
    const tx = buildTransaction({
      accountKeys: [address('payer'), PROGRAM],
      instructions: [instruction(1, [0], eventCpiData(DISCRIMINATOR))],
      logs: [
        `Program ${PROGRAM} invoke [1]`,
        `Program data: ${sameBytesAsCpi(DISCRIMINATOR)}`,
        `Program data: ${logPayload('aabbccddeeff0011')}`,
        `Program ${PROGRAM} success`,
      ],
    });

    expect(eventsOf(tx).map((e) => e.eventIndex)).toEqual([0, 1]);
  });
});
