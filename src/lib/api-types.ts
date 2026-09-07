/** What the REST API returns. The console imports these so the two agree. */

export interface Paginated<T> {
  data: T[];
  pagination: { limit: number; offset: number; count: number; hasMore: boolean };
}

/** A program is always identified by id; `label` is a convenience, often null. */
export interface ProgramRef {
  id: string;
  label: string | null;
}

/** Amounts are strings: a u64 can exceed what a JSON number holds. */
export interface Amount {
  mint: string;
  amount: string;
  decimals: number | null;
  /**
   * The mint's symbol, when a token list knows one — usually it does not, and
   * the console falls back to a shortened mint. Never trusted as an identity:
   * `mint` is what identifies the asset, `symbol` is only what to call it.
   */
  symbol: string | null;
}

export interface IndexerStatus {
  indexer: {
    lastProcessedSlot: number;
    lastBlockTime: string | null;
    lagSeconds: number | null;
    estimatedTipSlot: number | null;
    slotsProcessed: number;
    updatedAt: string | null;
  };
  totals: {
    slots: number;
    transactions: number;
    transfers: number;
    swaps: number;
    events: number;
    accounts: number;
    tokens: number;
  };
}

export interface Transfer {
  signature: string;
  slot: number;
  blockTime: string | null;
  instructionIndex: number;
  innerIndex: number | null;
  kind: 'sol' | 'spl';
  source: string;
  destination: string;
  sourceOwner: string | null;
  destinationOwner: string | null;
  amount: string;
  mint: string;
  decimals: number | null;
  symbol: string | null;
  program: ProgramRef;
}

export interface Swap {
  signature: string;
  slot: number;
  blockTime: string | null;
  owner: string;
  in: Amount;
  out: Amount;
  program: ProgramRef;
  route: ProgramRef[];
}

export interface ProgramEvent {
  signature: string;
  eventIndex: number;
  slot: number;
  blockTime: string | null;
  program: ProgramRef;
  source: 'log' | 'cpi';
  /** The event type, as Anchor's 8-byte discriminator in hex. */
  discriminator: string;
  /** Base64 payload. Decoding the fields would need the program's IDL. */
  data: string;
}

interface Transaction {
  signature: string;
  slot: number;
  blockTime: string | null;
  transactionIndex: number;
  success: boolean;
  err: string | null;
  fee: string;
  computeUnits: string | null;
  recentBlockhash: string | null;
  versioned: boolean;
  feePayer: string | null;
  signers: string[];
  accounts: string[];
  programs: ProgramRef[];
  logs: string[];
}

export interface TransactionDetail extends Transaction {
  transfers: Transfer[];
  swaps: Swap[];
  events: ProgramEvent[];
}

export type ActivityKind = 'transfer' | 'swap' | 'event';

/**
 * One row of a wallet's timeline. The three kinds share a shape so the feed can
 * be rendered without switching on `kind` first: `primary` is what moved, and
 * `counter` is the other side of a swap.
 */
export interface Activity {
  kind: ActivityKind;
  signature: string;
  slot: number;
  blockTime: string | null;
  program: ProgramRef;
  direction: 'in' | 'out' | null;
  primary: Amount | null;
  counter: Amount | null;
  discriminator: string | null;
}

export interface WalletPage<T> extends Paginated<T> {
  address: string;
}

/* ------------------------------------------------------------------ */
/* Watching                                                            */
/* ------------------------------------------------------------------ */

export type WatchKind = 'program' | 'wallet';

/** One entry of the indexer's own watchlist — the union across all browsers. */
export interface WatchEntry {
  kind: WatchKind;
  address: string;
  label: string | null;
  addedAt: string;
  /**
   * Updates this watch's own filter has matched.
   *
   * The only direct evidence that a watch is live. Its transactions also arrive
   * under the broad baseline filter, so without a per-watch count there is
   * nothing to distinguish a working subscription from an idle one.
   */
  matchedCount: number;
  lastMatchedSlot: number | null;
  lastMatchedAt: string | null;
}

export interface ProgramEventType {
  discriminator: string;
  source: 'log' | 'cpi';
  count: number;
  lastSlot: number | null;
}

export interface ProgramInvocation {
  signature: string;
  slot: number;
  invocationIndex: number;
  program: ProgramRef;
  depth: number;
  parentIndex: number | null;
  success: boolean;
  computeUnits: number | null;
  logs: string[];
}

/**
 * One write to a watched account.
 *
 * These come from the `accounts` subscription, which the worker opens only for
 * watched addresses — so an unwatched address simply has none.
 */
export interface AccountUpdate {
  pubkey: string;
  slot: number;
  writeVersion: string;
  owner: ProgramRef;
  lamports: string;
  executable: boolean;
  dataLength: number;
  signature: string | null;
  observedAt: string | null;
}

/** What `/api/programs/:programId` returns. */
export interface ProgramDetail {
  program: ProgramRef;
  invocationCount: number;
  eventCount: number;
  swapCount: number;
  lastSlot: number | null;
  eventTypes: ProgramEventType[];
  events: ProgramEvent[];
  invocations: ProgramInvocation[];
  accountUpdates: AccountUpdate[];
}
