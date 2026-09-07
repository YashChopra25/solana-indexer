import { CommitmentLevel, subscribe } from 'helius-laserstream';
import { COMMITMENT, LASERSTREAM_ENDPOINT, heliusApiKey } from '../config';
import { createLogger, errorMessage } from '../lib/logger';
import { subscriptionSet } from './subscription';
import type { WatchTarget } from '../store/watchlist';
import type { RawAccountUpdate, RawBlock, RawTransaction } from '../domain/types';
import {
  decodeAccountUpdate,
  decodeBlock,
  decodeTransaction,
  toNumber,
  type ProtoMessage,
} from './decode';

const log = createLogger('stream');

const COMMITMENT_LEVEL = {
  processed: CommitmentLevel.PROCESSED,
  confirmed: CommitmentLevel.CONFIRMED,
  finalized: CommitmentLevel.FINALIZED,
};

interface StreamHandlers {
  /** `matched` names the subscription filters this update satisfied. */
  onTransaction(tx: RawTransaction, matched: string[]): void;
  onAccount(update: RawAccountUpdate, matched: string[]): void;
  onBlock(block: RawBlock): void;
  onSlot(slot: number): void;
}

interface Subscription {
  /**
   * Narrows or widens what the stream delivers, without reconnecting.
   *
   * LaserStream accepts a fresh request on the open stream, so adding a watched
   * program takes effect on the next slot rather than costing a reconnect — and
   * a reconnect would mean a replay, a gap, or both.
   */
  update(watched: WatchTarget[]): void;
  /** Resolves when the signal aborts; rejects if the stream fails. */
  closed: Promise<void>;
}

/**
 * The filter name a watch's matches are reported under. The same name is used
 * for its transaction filter and its accounts filter, so either kind of match
 * counts towards the same watch.
 */
function watchFilterName(target: WatchTarget): string {
  return `watch:${target.kind}:${target.address}`;
}

/**
 * The subscription request: two filters over one stream.
 *
 * **transactions** carries everything the extractors work on. `accountInclude`
 * matches a transaction touching any listed account, and a program id is an
 * account like any other, so the tracked baseline and the watchlist go into one
 * flat list.
 *
 * **accounts** is what makes watching mean something. With a broad transaction
 * baseline — the System and Token programs match nearly every transaction on
 * the chain — adding a watched address to `accountInclude` narrows nothing and
 * looks like it does nothing. An `accounts` filter is a different question
 * altogether: tell me when *this account itself* changes, whoever changed it.
 * That answer is the same whether the baseline is one program or the firehose.
 *
 * Every field the proto defines is sent, including the empty ones. A request
 * replaces the previous subscription wholesale rather than patching it, so an
 * omitted map is indistinguishable from one deliberately cleared, and being
 * explicit is what makes an update predictable.
 *
 * `fromSlot` belongs only to the first request. Re-sending it on an update
 * would ask the server to replay from there again, which is the opposite of
 * what a live filter change should do.
 */
function buildRequest(watched: WatchTarget[], baseline: string[], fromSlot: number | null) {
  const accountInclude = subscriptionSet(
    baseline,
    watched.map((target) => target.address),
  );

  return {
    transactions: {
      // There is deliberately no `failed` flag here. Setting it returns *only*
      // failed transactions, whose instructions were rolled back on chain -- so
      // nothing would ever be extracted from them. Leaving it off indexes both,
      // and failures are stored with success = false.
      tracked: {
        accountInclude,
        accountExclude: [],
        accountRequired: [],
        vote: false,
      },
      // Each watch also gets a filter of its own. It matches a subset of what
      // `tracked` already matches, so it brings in no extra data -- what it
      // brings is a *name*. Every update reports which filters it satisfied, so
      // this is what lets a watch prove it is doing something, which the broad
      // baseline otherwise hides completely.
      ...Object.fromEntries(
        watched.map((target) => [
          watchFilterName(target),
          {
            accountInclude: [target.address],
            accountExclude: [],
            accountRequired: [],
            vote: false,
          },
        ]),
      ),
    },
    // One filter per watched address rather than one filter listing them all,
    // so an update that drops a single address cannot disturb the others.
    //
    // A wallet is matched by `account` and a program by `owner`: a program
    // account is executable and never changes, so watching it by account would
    // report nothing. What is worth hearing about is the accounts the program
    // owns and writes to.
    // `account` and `owner` inside one filter are ANDed, not ORed: asking for
    // both would mean "the account whose pubkey is X and whose owner is also X",
    // which is true of nothing. Each kind therefore sets exactly one of them.
    accounts: Object.fromEntries(
      watched.map((target) => [
        watchFilterName(target),
        target.kind === 'program'
          ? { account: [], owner: [target.address], filters: [] }
          : { account: [target.address], owner: [], filters: [] },
      ]),
    ),
    // Block metadata carries the block time and marks a slot complete.
    blocksMeta: { meta: {} },
    slots: { tip: { filterByCommitment: true } },
    accountsDataSlice: [],
    transactionsStatus: {},
    blocks: {},
    entry: {},
    commitment: COMMITMENT_LEVEL[COMMITMENT],
    ...(fromSlot !== null ? { fromSlot } : {}),
  };
}

/**
 * Opens one gRPC subscription to Helius and calls back for every update.
 *
 * The SDK handles ordinary blips itself — it reconnects and replays what was
 * missed — so a rejection from `closed` means something is actually wrong (a bad
 * key, the wrong endpoint), and the worker prints it and exits rather than
 * retrying in a loop that would only hide the cause.
 */
export async function openStream(
  handlers: StreamHandlers,
  options: {
    watched: WatchTarget[];
    baseline: string[];
    fromSlot: number | null;
    signal: AbortSignal;
  },
): Promise<Subscription> {
  const { watched, baseline, fromSlot, signal } = options;

  log.info('connecting', {
    endpoint: LASERSTREAM_ENDPOINT,
    fromSlot,
    baseline: baseline.length,
    watched: watched.length,
  });

  let failStream: (err: Error) => void = () => {};
  const streamFailed = new Promise<never>((_, reject) => {
    failStream = (err) => reject(new Error(`stream ended: ${errorMessage(err)}`));
  });

  const handle = await subscribe(
    { apiKey: heliusApiKey(), endpoint: LASERSTREAM_ENDPOINT, replay: true },
    buildRequest(watched, baseline, fromSlot),
    (update) => dispatch(update as ProtoMessage, handlers),
    (err) => failStream(err),
  );

  log.info('stream established');

  const closed = (async () => {
    try {
      await Promise.race([
        streamFailed,
        new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        ),
      ]);
    } finally {
      handle.cancel();
    }
  })();

  return {
    update(next: WatchTarget[]) {
      // A rejected rewrite must not take the worker down: the stream carries on
      // with the filter it already had, and the next reconcile tries again.
      void Promise.resolve(handle.write(buildRequest(next, baseline, null))).catch((err) =>
        log.warn('could not update subscription', { error: errorMessage(err) }),
      );
    },
    closed,
  };
}

/** An update is a transaction, an account write, block meta, or a slot tick. */
function dispatch(update: ProtoMessage, handlers: StreamHandlers): void {
  try {
    // Every update names the filters it satisfied. That is the only way to tell
    // an update the baseline pulled in from one a watch asked for, since both
    // arrive on the same stream.
    const matched = Array.isArray(update.filters) ? (update.filters as string[]) : [];

    if (update.transaction) {
      const tx = decodeTransaction(update.transaction as ProtoMessage);
      if (tx) handlers.onTransaction(tx, matched);
      return;
    }

    if (update.account) {
      const account = decodeAccountUpdate(update.account as ProtoMessage);
      if (account) handlers.onAccount(account, matched);
      return;
    }

    if (update.blockMeta) {
      handlers.onBlock(decodeBlock(update.blockMeta as ProtoMessage));
      return;
    }

    if (update.slot) {
      handlers.onSlot(toNumber((update.slot as ProtoMessage).slot));
    }

    // Anything else is a keepalive ping.
  } catch (err) {
    // One malformed update must never take the stream down.
    log.warn('could not handle update', { error: errorMessage(err) });
  }
}
