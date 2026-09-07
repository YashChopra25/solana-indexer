import 'dotenv/config';
import { TOKEN_LIST_BATCH } from '../src/config';
import { tryFetchTokenMeta } from '../src/chain/token-list';
import { closePool } from '../src/store/pool';
import { findUncheckedMints, readSymbolCoverage, saveTokenMeta } from '../src/store/tokens';

/**
 * `npm run tokens:sync` — names the mints the indexer has already seen.
 *
 * The worker does this continuously in the background; this runs the same sweep
 * to completion, which is what you want after a first import, or once against a
 * database filled before symbols existed.
 *
 * Expect a low hit rate and do not read it as a failure. This indexer tracks
 * System and SPL Token, so it sees every mint created on the chain, and the
 * overwhelming majority are minutes old and listed nowhere. The mints that do
 * resolve are the ones anybody recognises.
 */
async function main() {
  const before = await readSymbolCoverage();
  console.log(
    `${before.total} mints known, ${before.named} named, ${before.unchecked} never checked`,
  );

  let asked = 0;
  let named = 0;

  for (;;) {
    const mints = await findUncheckedMints(TOKEN_LIST_BATCH);
    if (mints.length === 0) break;

    const found = await tryFetchTokenMeta(mints);
    await saveTokenMeta(mints, found);

    asked += mints.length;
    named += found.length;

    // Rewrite one line at a terminal, print plain lines when redirected --
    // a carriage return in a log file just runs the batches together.
    process.stdout.write(
      process.stdout.isTTY ? `\rchecked ${asked}, named ${named}` : `checked ${asked}, named ${named}\n`,
    );
  }

  const after = await readSymbolCoverage();
  console.log(
    `\ndone — ${after.named} of ${after.total} mints named` +
      ` (${percent(after.named, after.total)}), ${after.unchecked} left unchecked`,
  );
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${((part / whole) * 100).toFixed(1)}%`;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closePool);
