import { createLogger, errorMessage } from '../lib/logger';
import { TOKEN_LIST_BATCH, TOKEN_LIST_ENDPOINT, TOKEN_LIST_TIMEOUT_MS } from '../config';

const log = createLogger('token-list');

/**
 * Names for mints, the way `programs.ts` holds names for program ids.
 *
 * A mint account stores decimals and authorities — not a symbol. The symbol
 * lives in Metaplex metadata, in a separate account this indexer never reads,
 * so it has to come from somewhere off-chain. That is the whole of this file:
 * ask a token list what a batch of mints is called.
 *
 * Nothing here is required for indexing. A mint with no symbol is stored,
 * queried and rendered exactly like one with a symbol — it just shows as a
 * shortened address. That matters more than it sounds, because it is the
 * common case: an indexer tracking System and SPL Token sees every mint that
 * exists, and almost all of them are minutes old and listed nowhere.
 */

export interface TokenMeta {
  mint: string;
  symbol: string | null;
  name: string | null;
}

/** What the token list returns per entry. Every field is optional to us. */
interface ListEntry {
  id?: unknown;
  symbol?: unknown;
  name?: unknown;
}

/**
 * Looks up a batch of mints. Returns one entry per mint that resolved; mints
 * with no listing are simply absent, and the caller records them as checked.
 *
 * Throws only if the request itself fails, so a caller can tell "the list is
 * unreachable" (retry later) from "these mints are unlisted" (never retry).
 */
export async function fetchTokenMeta(mints: string[]): Promise<TokenMeta[]> {
  if (mints.length === 0) return [];

  const found: TokenMeta[] = [];

  for (const batch of chunk(mints, TOKEN_LIST_BATCH)) {
    const url = `${TOKEN_LIST_ENDPOINT}?query=${batch.join(',')}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TOKEN_LIST_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`token list responded ${response.status}`);
    }

    const body: unknown = await response.json();

    if (!Array.isArray(body)) {
      throw new Error('token list did not return an array');
    }

    for (const entry of body as ListEntry[]) {
      const meta = readEntry(entry);
      if (meta) found.push(meta);
    }
  }

  return found;
}

function readEntry(entry: ListEntry): TokenMeta | null {
  if (typeof entry?.id !== 'string' || entry.id.length === 0) return null;

  const symbol = clean(entry.symbol, 12);
  const name = clean(entry.name, 40);

  // An entry that resolved to nothing usable is not worth a row; leaving it
  // unrecorded lets a later sync try again once the listing improves.
  if (symbol === null && name === null) return null;

  return { mint: entry.id, symbol, name };
}

/**
 * Invisible, layout-breaking and text-reordering characters. Written as escapes
 * rather than as themselves, because a literal zero-width character in the
 * source is exactly the thing this file exists to distrust.
 */
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
const INVISIBLE = /[\u00AD\u200B-\u200F\u2060\uFEFF]/g;
const BIDI = /[\u202A-\u202E\u2066-\u2069]/g;

/**
 * Anyone can mint a token and call it anything, so a symbol is hostile input
 * on the way to a page. Three things are stripped, in order of how much damage
 * they do:
 *
 * - **bidi overrides** reorder the text *around* them, so a symbol can rewrite
 *   the rest of the row it is rendered in;
 * - **zero-width and control characters** are invisible, which is how one token
 *   impersonates another that renders identically;
 * - **newlines and runs of whitespace** break the table layout.
 *
 * What survives is then capped, because the console gives a symbol a fixed
 * amount of room and a 200-character "symbol" is not a symbol.
 */
export function clean(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;

  const stripped = value
    // Whitespace collapses first, and the order is not incidental: a newline is
    // a control character, so stripping controls first would delete it outright
    // and turn "Wrapped\nSOL" into "WrappedSOL" rather than "Wrapped SOL".
    .replace(/\s+/g, ' ')
    .replace(CONTROL, '')
    .replace(INVISIBLE, '')
    .replace(BIDI, '')
    .trim();

  if (stripped.length === 0) return null;

  return stripped.length > maxLength ? stripped.slice(0, maxLength) : stripped;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }

  return batches;
}

/** Logs and swallows a lookup failure: symbols are decoration, never a reason to stop. */
export async function tryFetchTokenMeta(mints: string[]): Promise<TokenMeta[]> {
  try {
    return await fetchTokenMeta(mints);
  } catch (err) {
    log.warn('lookup failed', { mints: mints.length, error: errorMessage(err) });

    return [];
  }
}
