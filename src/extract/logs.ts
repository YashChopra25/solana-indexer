import type { IndexedInvocation } from '../domain/types';

/**
 * The log stream, turned back into the call tree that produced it.
 *
 * The runtime prints a flat list of lines, but it brackets every program call
 * with `invoke` and `success`/`failed`, so the tree is recoverable by keeping a
 * stack. That is what makes a log line attributable to a program at all — and
 * an Anchor event is just a log line, so it has to happen before events can be
 * read.
 *
 *   Program <id> invoke [1]
 *   Program log: instruction: Swap
 *   Program <id> invoke [2]        <- a CPI, one level deeper
 *   Program <id> success
 *   Program <id> consumed 1234 of 200000 compute units
 *   Program <id> success
 */

const INVOKE = /^Program (\S+) invoke \[(\d+)\]$/;
const SUCCESS = /^Program (\S+) success$/;
const FAILED = /^Program (\S+) failed: (.+)$/;
const CONSUMED = /^Program (\S+) consumed (\d+) of \d+ compute units$/;

/**
 * Splits a transaction's logs into one entry per program invocation.
 *
 * A truncated log — the runtime caps how much it will print — leaves
 * invocations open at the end. Those are still returned, marked unsuccessful,
 * because the lines they did capture are worth keeping.
 */
export function extractInvocations(logs: string[]): IndexedInvocation[] {
  const invocations: IndexedInvocation[] = [];
  const stack: number[] = [];

  for (const line of logs) {
    const invoke = INVOKE.exec(line);

    if (invoke) {
      const parent = stack.length > 0 ? stack[stack.length - 1] : null;

      invocations.push({
        invocationIndex: invocations.length,
        programId: invoke[1],
        depth: Number(invoke[2]),
        parentIndex: parent,
        // Set when the matching success line arrives; a call that never closes
        // stays false.
        success: false,
        computeUnits: null,
        logs: [],
      });

      stack.push(invocations.length - 1);
      continue;
    }

    const current = stack.length > 0 ? invocations[stack[stack.length - 1]] : null;

    const consumed = CONSUMED.exec(line);
    if (consumed && current && current.programId === consumed[1]) {
      current.computeUnits = Number(consumed[2]);
      continue;
    }

    const success = SUCCESS.exec(line);
    if (success && current && current.programId === success[1]) {
      current.success = true;
      stack.pop();
      continue;
    }

    const failed = FAILED.exec(line);
    if (failed && current && current.programId === failed[1]) {
      current.logs.push(line);
      stack.pop();
      continue;
    }

    // Anything else belongs to whichever program is currently running. Lines
    // printed before any invoke — the runtime's own — have nowhere to go.
    if (current) current.logs.push(line);
  }

  return invocations;
}
