import { toBase64, toBytes } from '../chain/bytes';
import type { IndexedEvent, IndexedInvocation, RawTransaction } from '../domain/types';
import { walkInstructions } from './accounts';

/**
 * Anchor events, from both places Anchor puts them.
 *
 * `emit!` writes a `Program data:` line into the logs. `emit_cpi!` instead
 * invokes the program against itself with the event as the instruction data,
 * behind a fixed 8-byte marker — which survives log truncation, and is why
 * newer programs prefer it.
 *
 * Neither form is decoded into fields here. Doing that needs the program's IDL,
 * and this indexer deliberately holds none: an event's first 8 bytes identify
 * its type, and keeping those plus the raw payload is enough to count events,
 * filter by type, and correlate them with the transfers and swaps around them.
 * Anyone who wants the fields has the bytes and can bring their own IDL.
 */

/** Anchor's marker for a self-CPI carrying an event. */
const EVENT_CPI_MARKER = 'e445a52e51cb9a1d';

const LOG_EVENT_PREFIX = 'Program data: ';

/** Anchor discriminators are the first 8 bytes of the payload. */
const DISCRIMINATOR_BYTES = 8;

function discriminatorOf(payload: Uint8Array): string | null {
  if (payload.length < DISCRIMINATOR_BYTES) return null;

  return Buffer.from(payload.subarray(0, DISCRIMINATOR_BYTES)).toString('hex');
}

/**
 * Events written to the logs, attributed to the program that was running when
 * the line was printed.
 */
function fromLogs(invocations: IndexedInvocation[], startIndex: number): IndexedEvent[] {
  const events: IndexedEvent[] = [];

  for (const invocation of invocations) {
    for (const line of invocation.logs) {
      if (!line.startsWith(LOG_EVENT_PREFIX)) continue;

      const encoded = line.slice(LOG_EVENT_PREFIX.length).trim();
      const payload = toBytes(encoded);
      const discriminator = discriminatorOf(payload);
      if (!discriminator) continue;

      events.push({
        eventIndex: startIndex + events.length,
        programId: invocation.programId,
        source: 'log',
        discriminator,
        data: encoded,
      });
    }
  }

  return events;
}

/**
 * Events emitted as a self-CPI. The instruction data is the marker followed by
 * the event payload, so the discriminator sits 8 bytes in.
 */
function fromInstructions(tx: RawTransaction, keys: string[]): IndexedEvent[] {
  const events: IndexedEvent[] = [];

  for (const { instruction } of walkInstructions(tx)) {
    const programId = keys[instruction.programIdIndex];
    if (!programId) continue;

    const data = instruction.data;
    if (data.length < DISCRIMINATOR_BYTES * 2) continue;

    const marker = Buffer.from(data.subarray(0, DISCRIMINATOR_BYTES)).toString('hex');
    if (marker !== EVENT_CPI_MARKER) continue;

    const payload = data.subarray(DISCRIMINATOR_BYTES);
    const discriminator = discriminatorOf(payload);
    if (!discriminator) continue;

    events.push({
      eventIndex: events.length,
      programId,
      source: 'cpi',
      discriminator,
      data: toBase64(payload),
    });
  }

  return events;
}

/**
 * Every Anchor event in a transaction, each counted once.
 *
 * `emit_cpi!` surfaces an event **twice**: as the self-CPI instruction and as a
 * `Program data:` log line carrying the same bytes. Both are read above,
 * because a program using plain `emit!` produces only the log, so neither
 * source can be ignored — but a payload found in both places is one event, not
 * two, and counting it twice doubles every per-program total.
 *
 * Each log event is therefore matched against an unclaimed CPI event with the
 * same program and the same bytes, and dropped if one is found. Matching by
 * count rather than by mere presence is what keeps a program that genuinely
 * emits the same event twice in one transaction at two events rather than one.
 *
 * CPI events are the ones kept: they survive the log truncation the runtime
 * applies to busy transactions.
 */
export function extractEvents(
  tx: RawTransaction,
  keys: string[],
  invocations: IndexedInvocation[],
): IndexedEvent[] {
  const cpi = fromInstructions(tx, keys);
  const unclaimed = new Map<string, number>();

  for (const event of cpi) {
    const key = `${event.programId}:${event.data}`;
    unclaimed.set(key, (unclaimed.get(key) ?? 0) + 1);
  }

  const logged = fromLogs(invocations, 0).filter((event) => {
    const key = `${event.programId}:${event.data}`;
    const duplicates = unclaimed.get(key) ?? 0;

    if (duplicates === 0) return true;

    unclaimed.set(key, duplicates - 1);
    return false;
  });

  // Renumbered after filtering so `eventIndex` stays a dense 0..n-1 key.
  return [...cpi, ...logged].map((event, eventIndex) => ({ ...event, eventIndex }));
}
