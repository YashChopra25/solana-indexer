import {
  FLUSH_INTERVAL_MS,
  MAX_BUFFERED_SLOTS,
  SLOTS_PER_COMMIT,
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

  /** Set when the buffer outgrew its limit; the worker then exits non-zero. */
  private fellBehind = false;

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
      tipSlot: this.window.tipSlot,
      watching: this.watched.length,
    };
  }

  get overloaded(): boolean {
    return this.fellBehind;
  }

  async run(signal: AbortSignal): Promise<void> {
    const fromSlot = await this.resumeSlot();

    // Our own controller, so the overload guard below can end the stream exactly
    // the way a SIGINT does rather than needing a second shutdown path.
    const stop = new AbortController();
    const relay = () => stop.abort();
    signal.addEventListener('abort', relay, { once: true });
    this.stopStream = relay;

    this.watched = await this.watchTargets();

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
  private async reconcileWatchlist(stream: { update(watched: WatchTarget[]): void }): Promise<void> {
    const next = await this.watchTargets();

    const before = this.watched.map(targetKey);
    const after = next.map(targetKey);
    if (sameSet(before, after)) return;

    this.watched = next;
    stream.update(next);

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
      const targets = await readWatchTargets(getPool());
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
    if (this.fellBehind || this.window.size <= MAX_BUFFERED_SLOTS) return;

    this.fellBehind = true;
    log.error('too far behind, stopping', {
      bufferedSlots: this.window.size,
      limit: MAX_BUFFERED_SLOTS,
      reason: 'slots are arriving faster than Postgres can take them',
      recovery: 'restart to resume from the checkpoint',
    });

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
   * checkpoint bump, so a chunk that fails is simply replayed after a restart.
   */
  private async commitReady(): Promise<void> {
    await this.commitAccountUpdates();
    await this.flushWatchMatches();

    const ready = this.window.drainReady();

    for (let start = 0; start < ready.length; start += SLOTS_PER_COMMIT) {
      const chunk = ready.slice(start, start + SLOTS_PER_COMMIT);

      try {
        const written = await withTransaction((client) => persistSlots(client, chunk));

        this.stats.slots += chunk.length;
        this.stats.transactions += written.transactions;
        this.stats.transfers += written.transfers;
        this.stats.swaps += written.swaps;
        this.stats.events += written.events;
      } catch (err) {
        // Stop here rather than committing later chunks: the checkpoint must not
        // move past a slot that failed, or that slot is lost for good.
        log.error('could not commit slots', {
          from: chunk[0].slot,
          to: chunk[chunk.length - 1].slot,
          dropped: ready.length - start,
          error: errorMessage(err),
        });
        return;
      }
    }
  }

  /**
   * Writes whatever account updates have arrived since the last flush.
   *
   * Taken out of the buffer before the await, so updates that arrive during the
   * write are kept for the next round rather than lost with it.
   */
  /** Writes the match tallies, taken before the await so nothing is lost. */
  private async flushWatchMatches(): Promise<void> {
    if (this.watchMatches.size === 0) return;

    const matches = this.watchMatches;
    this.watchMatches = new Map();

    try {
      await recordWatchMatches(getPool(), matches);
    } catch (err) {
      log.warn('could not record watch matches', { error: errorMessage(err) });
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
      log.error('could not write account updates', {
        count: batch.length,
        error: errorMessage(err),
      });
    }
  }

  /**
   * On shutdown, commit what is buffered instead of throwing it away.
   *
   * The first await lets a commit that is already running finish — it has
   * drained slots out of the buffer already, and abandoning it would lose them.
   * Only then is the rest released and written.
   */
  private async flushAll(): Promise<void> {
    await this.flush();
    this.window.releaseAll();
    await this.flush();
  }
}
