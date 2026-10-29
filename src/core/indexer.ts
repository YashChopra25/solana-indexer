import {
  FLUSH_INTERVAL_MS,
  MAX_BUFFERED_SLOTS,
  MAX_BUFFERED_TRANSACTIONS,
  MAX_COMMIT_FAILURES,
  SLOTS_PER_COMMIT,
  SUBSCRIPTION_RESYNC_MS,
  MAX_PENDING_ACCOUNT_UPDATES,
  SLOT_FLUSH_LAG,
  TOKEN_SYNC_BATCH,
  TOKEN_SYNC_INTERVAL_MS,
  TRACKED_PROGRAM_IDS,
  WATCHLIST_POLL_MS,
} from '../config';
import { getPool, withTransaction } from '../store/pool';
import { persistAccountUpdates, persistSlots, readCheckpoint } from '../store/write';
import { readWatchTargets, recordWatchMatches, type WatchTarget } from '../store/watchlist';
import { findUncheckedMints, saveTokenMeta } from '../store/tokens';
import { tryFetchTokenMeta } from '../chain/token-list';
import { isUnwatchableProgram } from '../chain/programs';
import { indexTransaction } from '../extract/transaction';
import { createLogger, errorMessage } from '../lib/logger';
import type { RawAccountUpdate, RawBlock, RawTransaction } from '../domain/types';
import { SlotWindow } from './slot-window';
import { openStream } from './stream';
import { sameSet, targetKey, watchingAffectsIngestion } from './subscription';

const log = createLogger('indexer');

/**
 * The whole pipeline in one class: read the stream, extract everything from
 * each transaction, buffer it under its slot, and commit finished slots.
 */
export class Indexer {
  private readonly window = new SlotWindow(SLOT_FLUSH_LAG);

  private readonly stats = {
    slots: 0,
    transactions: 0,
    transfers: 0,
    swaps: 0,
    events: 0,
    accountUpdates: 0,
    droppedAccountUpdates: 0,
    skipped: 0,
    mintsChecked: 0,
    mintsNamed: 0,
  };

  /**
   * Account writes waiting to be stored.
   *
   * Not part of the slot window: these arrive from the accounts filter, belong
   * to no transaction the indexer is holding, and their natural key already
   * makes a replay harmless. Holding them until a slot closed would delay them
   * for no gain.
   */
  private pendingAccounts: RawAccountUpdate[] = [];

  /**
   * What each watch's own filter has matched since the last flush.
   *
   * Tallied in memory because a busy watch matches hundreds of updates a
   * second, and a database write per update would cost more than the indexing
   * it reports on.
   */
  private watchMatches = new Map<string, { count: number; slot: number }>();

  /**
   * The commit currently running, if any. Holding the promise rather than a
   * boolean means a second caller waits for it instead of skipping — which is
   * what shutdown needs, or it would drop whatever a running commit had not yet
   * reached.
   */
  private committing: Promise<void> | null = null;

  /**
   * Why the worker stopped itself, if it did: the buffer outgrew its limit, or
   * Postgres kept refusing commits. Either way it exits non-zero for its
   * supervisor, and resumes from the checkpoint.
   */
  private failure: string | null = null;

  /** Commit attempts in a row that have failed. */
  private commitFailures = 0;

  /** No commit is tried before this time; it backs off after each failure. */
  private retryAt = 0;

  /** The checkpoint as last committed: stragglers at or below it are released. */
  private checkpoint = 0;

  /** When the subscription was last sent to the stream. */
  private subscribedAt = Date.now();

  /**
   * True while a symbol sweep is in flight, so a slow one is skipped rather
   * than overlapped -- two sweeps would ask about the same unchecked mints.
   */
  private syncingTokens = false;

  /** Stops the stream from inside, the same way Ctrl-C stops it from outside. */
  private stopStream: () => void = () => {};

  /** The watchlist as the stream currently has it, sorted by `targetKey`. */
  private watched: WatchTarget[] = [];

  getStats() {
    return {
      ...this.stats,
      bufferedSlots: this.window.size,
      bufferedTransactions: this.window.transactionCount,
      tipSlot: this.window.tipSlot,
      watching: this.watched.length,
    };
  }

  /** Set when the worker stopped itself; it should then exit non-zero. */
  get failed(): string | null {
    return this.failure;
  }

  async run(signal: AbortSignal): Promise<void> {
    // Our own controller, so the overload guard below can end the stream exactly
    // the way a SIGINT does rather than needing a second shutdown path. Wired
    // up before the first await, and checked after each one: a signal that
    // fired during startup must not be missed.
    const stop = new AbortController();
    const relay = () => stop.abort();
    if (signal.aborted) return;
    signal.addEventListener('abort', relay, { once: true });
    this.stopStream = relay;

    const fromSlot = await this.resumeSlot();
    this.checkpoint = fromSlot === null ? 0 : fromSlot - 1;
    this.watched = await this.watchTargets();
    if (stop.signal.aborted) return;

    if (!watchingAffectsIngestion(TRACKED_PROGRAM_IDS)) {
      log.warn('TRACKED_PROGRAM_IDS is empty, so every transaction is already ingested', {
        effect: 'watching still adds an accounts subscription, which is unaffected',
      });
    }

    const stream = await openStream(
      {
        onTransaction: (tx, matched) => {
          this.noteMatches(matched, tx.slot);
          this.handleTransaction(tx);
        },
        onAccount: (update, matched) => {
          this.noteMatches(matched, update.slot);
          this.handleAccount(update);
        },
        onBlock: (block) => this.handleBlock(block),
        onSlot: (slot) => this.window.noteTip(slot),
      },
      { watched: this.watched, baseline: TRACKED_PROGRAM_IDS, fromSlot, signal: stop.signal },
    );

    const flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    const watchTimer = setInterval(() => void this.reconcileWatchlist(stream), WATCHLIST_POLL_MS);
    const tokenTimer =
      TOKEN_SYNC_INTERVAL_MS > 0
        ? setInterval(() => void this.syncTokenSymbols(), TOKEN_SYNC_INTERVAL_MS)
        : null;

    try {
      await stream.closed;
    } finally {
      clearInterval(flushTimer);
      clearInterval(watchTimer);
      if (tokenTimer) clearInterval(tokenTimer);
      signal.removeEventListener('abort', relay);
      await this.flushAll();
    }
  }

  /**
   * Picks up watchlist changes made in a browser.
   *
   * The web app and this worker share nothing but Postgres, so a table poll is
   * the whole channel. It is a handful of rows every few seconds, and it keeps
   * the two processes as independent as they were designed to be -- neither has
   * to be running for the other to start.
   */
  private async reconcileWatchlist(stream: {
    update(watched: WatchTarget[]): Promise<boolean>;
  }): Promise<void> {
    const next = await this.watchTargets();

    const before = this.watched.map(targetKey);
    const after = next.map(targetKey);
    const due = Date.now() - this.subscribedAt >= SUBSCRIPTION_RESYNC_MS;
    if (sameSet(before, after) && !due) return;

    // Only remembered once the stream took it, so a rejected rewrite is tried
    // again on the next poll instead of being mistaken for done.
    if (!(await stream.update(next))) return;

    this.watched = next;
    this.subscribedAt = Date.now();
    if (sameSet(before, after)) return;

    log.info('subscription updated', {
      watching: next.length,
      added: after.filter((key) => !before.includes(key)),
      removed: before.filter((key) => !after.includes(key)),
    });
  }

  /**
   * Names the mints nobody has looked up yet.
   *
   * The one place this project reaches outside itself, and deliberately the
   * least important: it runs on its own timer, off the indexing path, and
   * anything it fails to do leaves mints rendering as shortened addresses --
   * which is what most of them do anyway. So every failure is a warning, never
   * a reason to interrupt a stream that is working.
   */
  private async syncTokenSymbols(): Promise<void> {
    if (this.syncingTokens) return;
    this.syncingTokens = true;

    try {
      const mints = await findUncheckedMints(TOKEN_SYNC_BATCH);
      if (mints.length === 0) return;

      const found = await tryFetchTokenMeta(mints);
      await saveTokenMeta(mints, found);

      this.stats.mintsChecked += mints.length;
      this.stats.mintsNamed += found.length;
    } catch (err) {
      log.warn('token symbol sweep failed', { error: errorMessage(err) });
    } finally {
      this.syncingTokens = false;
    }
  }

  /**
   * The watchlist, sorted so two reads of the same set compare equal.
   *
   * A failed read returns what the stream already has: a database blip must
   * never be able to silently clear the subscription.
   */
  private async watchTargets(): Promise<WatchTarget[]> {
    try {
      // Never subscribe by owner to a program that owns most of the chain, even
      // if one reached the table before the API refused them.
      const targets = (await readWatchTargets(getPool())).filter(
        (t) => !(t.kind === 'program' && isUnwatchableProgram(t.address)),
      );
      return targets.sort((a, b) => targetKey(a).localeCompare(targetKey(b)));
    } catch (err) {
      log.warn('could not read the watchlist', { error: errorMessage(err) });
      return this.watched;
    }
  }

  /**
   * Where to pick up. The checkpoint is the last slot fully committed, so the
   * next one is the first still needed. Null means "start at the tip".
   */
  private async resumeSlot(): Promise<number | null> {
    const checkpoint = await readCheckpoint(getPool());

    if (!checkpoint || checkpoint.lastProcessedSlot === 0) {
      log.info('no checkpoint, starting from the chain tip');
      return null;
    }

    log.info('resuming', { after: checkpoint.lastProcessedSlot });
    return checkpoint.lastProcessedSlot + 1;
  }

  private handleTransaction(tx: RawTransaction): void {
    if (tx.isVote) return;

    try {
      this.window.add(indexTransaction(tx));
    } catch (err) {
      // Drop the one transaction rather than stall every other slot behind it.
      this.stats.skipped++;
      log.warn('could not index transaction', {
        signature: tx.signature,
        error: errorMessage(err),
      });
    }

    this.checkBacklog();
  }

  /**
   * Queues one account write.
   *
   * Watching a program means every account it owns, which for a busy program is
   * a firehose of its own. The queue is capped and the oldest are dropped: an
   * account update is a snapshot of current state, so the newest is the one
   * worth keeping.
   */
  private handleAccount(update: RawAccountUpdate): void {
    this.pendingAccounts.push(update);

    if (this.pendingAccounts.length > MAX_PENDING_ACCOUNT_UPDATES) {
      const overflow = this.pendingAccounts.length - MAX_PENDING_ACCOUNT_UPDATES;
      this.pendingAccounts.splice(0, overflow);
      this.stats.droppedAccountUpdates += overflow;
    }
  }

  /**
   * Tallies an update against the watches whose filters matched it.
   *
   * The baseline filter is ignored: it matches nearly everything, so counting
   * it would say nothing about any particular watch.
   */
  private noteMatches(matched: string[], slot: number): void {
    for (const name of matched) {
      if (!name.startsWith('watch:')) continue;

      const seen = this.watchMatches.get(name);
      this.watchMatches.set(name, {
        count: (seen?.count ?? 0) + 1,
        slot: Math.max(seen?.slot ?? 0, slot),
      });
    }
  }

  private handleBlock(block: RawBlock): void {
    this.window.addBlock(block);
    // Block metadata is what marks a slot finished, so try to commit right away.
    void this.flush();
  }

  /**
   * Ingestion is a callback that cannot be slowed down: the stream pushes, and
   * after a reconnect it replays everything missed at once. If commits cannot
   * keep up, the buffer is where that shows — so it is where we stop, rather
   * than filling the heap and being killed with the buffer still in it.
   */
  private checkBacklog(): void {
    if (this.failure) return;
    if (
      this.window.size <= MAX_BUFFERED_SLOTS &&
      this.window.transactionCount <= MAX_BUFFERED_TRANSACTIONS
    ) {
      return;
    }

    this.stop('too far behind', {
      bufferedSlots: this.window.size,
      bufferedTransactions: this.window.transactionCount,
      limits: { slots: MAX_BUFFERED_SLOTS, transactions: MAX_BUFFERED_TRANSACTIONS },
      reason: 'slots are arriving faster than Postgres can take them',
    });
  }

  /** Ends the stream on purpose; the worker then exits non-zero. */
  private stop(reason: string, detail: Record<string, unknown>): void {
    this.failure = reason;
    log.error(`${reason}, stopping`, { ...detail, recovery: 'restart to resume from the checkpoint' });
    this.stopStream();
  }

  /** Only one commit runs at a time; everyone else waits for that one. */
  private flush(): Promise<void> {
    this.committing ??= this.commitReady().finally(() => {
      this.committing = null;
    });

    return this.committing;
  }

  /**
   * Commits every slot the buffer says is ready, several per Postgres
   * transaction. Each chunk lands whole or not at all, together with its
   * checkpoint bump.
   *
   * A chunk that fails goes back into the buffer with everything after it, and
   * the next flush tries again. Dropping it instead would let the next chunk
   * move the checkpoint past it, and those slots would be gone for good.
   */
  private async commitReady(): Promise<void> {
    // After a failure, wait out the backoff rather than hammering a database
    // that is already struggling; blocks keep asking for a flush meanwhile.
    if (Date.now() < this.retryAt) return;

    await this.commitAccountUpdates();
    await this.flushWatchMatches();

    this.window.releaseThrough(this.checkpoint);

    for (;;) {
      const chunk = this.window.drainReady(SLOTS_PER_COMMIT);
      if (chunk.length === 0) return;

      try {
        // Never past a slot still being buffered: it may be older than this
        // chunk, and a restart resumes from the checkpoint.
        const oldest = this.window.oldestSlot();
        const newest = chunk[chunk.length - 1].slot;
        const checkpoint = oldest === null ? newest : Math.min(newest, oldest - 1);

        const written = await withTransaction((client) => persistSlots(client, chunk, checkpoint));
        this.checkpoint = Math.max(this.checkpoint, checkpoint);
        this.commitFailures = 0;

        this.stats.slots += chunk.length;
        this.stats.transactions += written.transactions;
        this.stats.transfers += written.transfers;
        this.stats.swaps += written.swaps;
        this.stats.events += written.events;
      } catch (err) {
        // Keep the chunk for the next attempt; everything after it is still
        // in the buffer.
        this.window.restore(chunk);
        this.commitFailures++;
        const delay = Math.min(30_000, 500 * 2 ** this.commitFailures);
        this.retryAt = Date.now() + delay;

        log.error('could not commit slots, will retry', {
          from: chunk[0].slot,
          to: newestOf(chunk),
          attempt: this.commitFailures,
          retryInMs: delay,
          error: errorMessage(err),
        });

        if (this.commitFailures >= MAX_COMMIT_FAILURES) {
          this.stop('Postgres keeps refusing commits', { attempts: this.commitFailures });
        }
        return;
      }
    }
  }

  /** Writes the match tallies, taken before the await so nothing is lost. */
  private async flushWatchMatches(): Promise<void> {
    if (this.watchMatches.size === 0) return;

    const matches = this.watchMatches;
    this.watchMatches = new Map();

    try {
      await recordWatchMatches(getPool(), matches);
    } catch (err) {
      // Merged back, so the counts are late rather than wrong.
      for (const [name, { count, slot }] of matches) {
        const seen = this.watchMatches.get(name);
        this.watchMatches.set(name, {
          count: (seen?.count ?? 0) + count,
          slot: Math.max(seen?.slot ?? 0, slot),
        });
      }
      log.warn('could not record watch matches, will retry', { error: errorMessage(err) });
    }
  }

  private async commitAccountUpdates(): Promise<void> {
    if (this.pendingAccounts.length === 0) return;

    const batch = this.pendingAccounts;
    this.pendingAccounts = [];

    try {
      this.stats.accountUpdates += await withTransaction((client) =>
        persistAccountUpdates(client, batch),
      );
    } catch (err) {
      // Back in front of anything newer, still under the cap -- the oldest go
      // first, as they would have anyway.
      this.pendingAccounts = batch.concat(this.pendingAccounts);
      const overflow = this.pendingAccounts.length - MAX_PENDING_ACCOUNT_UPDATES;
      if (overflow > 0) {
        this.pendingAccounts.splice(0, overflow);
        this.stats.droppedAccountUpdates += overflow;
      }

      log.error('could not write account updates, will retry', {
        count: batch.length,
        error: errorMessage(err),
      });
    }
  }

  /**
   * On shutdown, commit every slot that is finished.
   *
   * The first await lets a commit that is already running finish -- it has
   * drained slots out of the buffer already. Slots still unfinished are left
   * alone: committing them would mark half-received slots as done. The
   * checkpoint stays below them, so the stream replays them on restart.
   */
  private async flushAll(): Promise<void> {
    await this.flush();
    // One last try even if a failure had it backing off.
    this.retryAt = 0;
    await this.flush();
  }
}

function newestOf(chunk: { slot: number }[]): number {
  return chunk[chunk.length - 1].slot;
}
