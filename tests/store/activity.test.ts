import { describe, expect, it } from 'vitest';
import { ACTIVITY_COLUMNS, activityBranches } from '../../src/store/read';

/**
 * A UNION takes its column names from the first branch only.
 *
 * So a branch that omits its aliases works perfectly until a filter drops the
 * branches ahead of it — at which point every column in the result is silently
 * renamed and the rows come back with the right values under the wrong keys.
 * Nothing throws; the API just answers with `undefined` where a mint should be.
 *
 * These tests read the generated SQL rather than run it, so they catch that
 * without a database.
 */

const KINDS = ['transfer', 'swap', 'event'] as const;

/** The column names a branch actually projects, in order. */
function aliasesOf(sql: string): string[] {
  return [...sql.matchAll(/\bAS ([a-z_]+)/g)].map((match) => match[1]);
}

describe('activityBranches', () => {
  it('returns one branch per requested kind', () => {
    expect(activityBranches(KINDS)).toHaveLength(3);
    expect(activityBranches(['swap'])).toHaveLength(1);
    expect(activityBranches([])).toHaveLength(0);
  });

  it('projects exactly ACTIVITY_COLUMNS, in order, from every branch', () => {
    for (const kind of KINDS) {
      const [sql] = activityBranches([kind]);
      expect(aliasesOf(sql), `${kind} branch`).toEqual([...ACTIVITY_COLUMNS]);
    }
  });

  it('gives every branch the same columns, so order cannot change the result', () => {
    const [transfer, swap, event] = KINDS.map((kind) => aliasesOf(activityBranches([kind])[0]));

    expect(swap).toEqual(transfer);
    expect(event).toEqual(transfer);
  });

  it('names its kind, whichever branch happens to come first', () => {
    // The regression: with `?kind=swap` the swap branch led the UNION, and
    // without aliases the `kind` column came back named `text` instead.
    for (const kind of KINDS) {
      const [sql] = activityBranches([kind]);
      expect(sql).toContain(`'${kind}'::TEXT AS kind`);
    }
  });

  it('keeps each branch filtering on its own indexed column', () => {
    const [transfer] = activityBranches(['transfer']);
    const [swap] = activityBranches(['swap']);
    const [event] = activityBranches(['event']);

    // A view over computed columns would lose these index lookups.
    expect(transfer).toContain('t.source_owner = $1');
    expect(swap).toContain('s.owner = $1');
    expect(event).toContain('tx.signers @> ARRAY[$1]::TEXT[]');
  });
});
