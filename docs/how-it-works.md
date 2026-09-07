# How it works

A walk through the whole pipeline, in the order data moves through it. The
README has the quick version; this is the one that explains *why*.

1. [Vocabulary](#vocabulary)
2. [The shape of the thing](#the-shape-of-the-thing)
3. [Getting transactions — `src/core/`](#getting-transactions--srccore)
4. [Extracting — `src/extract/`](#extracting--srcextract)
5. [Writing it down — `src/store/`](#writing-it-down--srcstore)
6. [Reading it back — `src/server/` and `src/app/api/`](#reading-it-back--srcserver-and-srcappapi)
7. [Watching — `src/lib/watch-store.ts` and `watchlist`](#watching--srclibwatch-storets-and-watchlist)
8. [The console](#the-console)
9. [What happens when things break](#what-happens-when-things-break)
10. [Adding to it](#adding-to-it)

---

## Vocabulary

**Slot** — a ~400ms time box in which one validator may produce a block. Slots
are numbered and always increase. Some produce no block, which is normal.

**Transaction** — one or more instructions submitted together, identified by a
base58 **signature**. It either succeeds entirely or fails entirely.

**Instruction** — one call to one program. An instruction can call another
program (a **CPI**); those appear separately as *inner instructions*.

**Account** — everything on Solana is an account with an address. A wallet is an
account. A token balance lives in its own account (a *token account*) owned by
the wallet.

**Discriminator** — the first 8 bytes of an Anchor payload, identifying which
instruction or event it is. It is a hash of the name, so it identifies the type
without revealing it.

**Lamport** — 0.000000001 SOL. All on-chain amounts are unsigned 64-bit
integers, which is why this project passes them around as `bigint` and returns
them from the API as strings.

---

## The shape of the thing

Two processes. They never talk to each other; they share one database.

```
   npm run indexer                              npm run dev
   ══════════════════════════════               ═══════════════════
   src/worker.ts                                src/app/api/**/route.ts
        │                                              │
        ▼                                              ▼
   src/core/stream.ts        subscribe          src/store/read.ts
        │  raw protobuf                               │  SELECT
        ▼                                             ▼
   src/core/decode.ts        wire → objects          JSON
        │                                             │
        ▼                                             ▼
   src/extract/*.ts          transfers, swaps,   src/components/console
        │                    events, invocations       the console
        ▼
   src/core/slot-window.ts   hold until slot is done
        │
        ▼
   src/store/write.ts        one chunk = one COMMIT
        │
        ▼
   ┌────────────────────────────────────────┐
   │  Postgres                              │
   │  slots · transactions · instructions   │
   │  transfers · swaps · events            │
   │  invocations · accounts · tokens       │
   │  indexer_state ← the checkpoint        │
   └────────────────────────────────────────┘
```

Either process can be restarted at any moment without telling the other.

---

## Getting transactions — `src/core/`

**`stream.ts`** opens one gRPC subscription to Helius and asks for three things:
transactions touching the tracked programs, block metadata, and slot ticks.

Two details are worth reading the comments for:

- There is deliberately **no `failed` flag** on the transaction filter. Setting
  it returns only *failed* transactions, whose instructions were rolled back on
  chain — so nothing would ever be extracted from them. Leaving it off indexes
  both, and failures are stored with `success = false`.
- **There is no reconnect loop.** The Helius SDK already reconnects and replays
  what was missed. If the stream fails in a way the SDK gives up on, something is
  actually wrong — a bad key, the wrong endpoint — and a retry loop would only
  hide it. The worker prints the reason and exits; start it again and the
  checkpoint puts it back where it was.

**`decode.ts`** is the only file that knows about protobuf. It turns wire types
into ordinary JavaScript: byte arrays into base58, the several shapes a protobuf
uint64 arrives in into `bigint`. Replacing the data source means replacing this
file and nothing else.

**`slot-window.ts`** solves one problem: transactions and block metadata arrive
on the same stream, in no guaranteed order, and nothing announces "that was the
last transaction of slot 12345". So they pile up in a `Map` keyed by slot, and a
slot is done when either its **block metadata arrives** — the only signal that
really means complete — or the chain has moved **24 slots past it**, the fallback
so a slot whose metadata never turns up is written anyway.

Inside a slot, transactions are keyed by signature, so the same transaction
delivered twice is de-duplicated before it ever reaches Postgres.

**`indexer.ts`** is the wiring: read, extract, buffer, and flush ready slots —
every two seconds on a timer, and immediately whenever block metadata arrives.
Only one commit runs at a time; the in-flight promise is held so a second
trigger waits for it rather than starting its own, which is what shutdown needs
to avoid dropping slots a running commit had already drained.

---

## Extracting — `src/extract/`

Pure functions: no database, no network, no clock. That is why they are the
easiest part to test, and where nearly all the tests are.

### Accounts come first

On the wire an instruction refers to its accounts by position in a list that has
to be rebuilt: the static message keys, then writable addresses loaded from
lookup tables, then readonly ones. Instruction indexes point into *that*
combined list, in that order. Every other extractor starts from it.

### Transfers — decoded

`transfers.ts` walks every instruction, top-level and inner, and asks the two
decoders in `src/chain/instructions.ts` whether it moved anything.

The interesting case is plain SPL `Transfer`. It does not name the mint — the
accounts are just `[source, destination, authority]`, and the source is a token
account, not a wallet. So the mint is recovered from the transaction's
`preTokenBalances` / `postTokenBalances`, which map account index → mint, owner
and decimals. `TransferChecked` carries the mint directly, which is exactly why
it exists. If a mint cannot be resolved, the transfer is skipped rather than
stored under a guess.

Those same snapshots give the *owner* behind each token account, which is what
lets a wallet lookup find transfers by wallet and not only by token account.

### Swaps — inferred

`swaps.ts` decodes nothing. It builds each owner's net movement per mint from
the balance snapshots, adds native SOL from `preBalances`/`postBalances`, and
looks for one asset down and another up.

**Why not decode each DEX?** Because that is a decoder per venue per version,
and it silently stops working the day a program upgrades. Balance movement is
the *definition* of a swap rather than one venue's spelling of it, so it covers
Jupiter, Raydium, Orca, Meteora, pump.fun and anything launched next week,
with nothing to maintain. The price is that a multi-hop route shows as what went
in and what came out rather than as its legs — the route's programs are kept in
`route_programs` so the path survives.

Four rules do the real work, and each exists because of a specific false
positive:

| Rule | Without it |
| --- | --- |
| The owner must have **signed** | Every swap is recorded twice — the pool's token accounts move in exact opposition to the trader's, so the pool looks like it swapped backwards |
| A **non-infrastructure program** must have run | Opening a token account spends SOL while tokens arrive, which is the exact shape of a small purchase |
| **Small SOL movements are ignored** when tokens also moved | Fees and rent become a leg of the trade |
| **Wrapping is not swapping** | Every SOL→wSOL wrap is a swap of an asset for itself |

The signer rule is the load-bearing one. Pool authorities are program-derived
and never sign a transaction; the person doing the swapping does.

When an owner has two assets going out or two coming in, nothing is recorded.
That is a route or a liquidity operation whose legs balances alone cannot
separate, and a guess would be worse than a gap.

### Events and the log index

The runtime prints a flat list of log lines, but it brackets every program call
with `invoke` and `success`/`failed`, so the call tree is recoverable with a
stack. `logs.ts` does that, producing one `invocations` row per call with the
lines printed inside it. This has to happen before events, because a log event
is attributed to whichever program was running when the line printed.

`events.ts` then reads Anchor events from both places Anchor puts them:

- **`emit!`** writes `Program data: <base64>` into the logs.
- **`emit_cpi!`** invokes the program against itself with the event as
  instruction data, behind the fixed marker `e445a52e51cb9a1d`. This survives
  log truncation, which is why newer programs prefer it.

Neither is decoded into fields. That needs the program's IDL, and this indexer
holds none — deliberately, because an IDL registry is a whole subsystem and the
discriminator plus the raw payload is already enough to count events, filter by
type, and correlate them with the transfers and swaps around them.

**One event, two sources.** `emit_cpi!` puts the same bytes in both places: the
self-CPI instruction *and* a `Program data:` line. Both are read — a program
using plain `emit!` produces only the log, so neither can be ignored — but a
payload found in both is one event. Each log event is matched against an
unclaimed CPI event with the same program and bytes and dropped if one is found.
Matching by count rather than presence is what keeps a program that genuinely
emits the same event twice in one transaction at two events rather than one.
This is not a theoretical case: on mainnet it is what every Anchor program using
`emit_cpi!` does, and without it every per-program total is exactly doubled.

---

## Writing it down — `src/store/`

**Rows and checkpoint are one Postgres transaction.** The slot row, the
transactions, their instructions, transfers, swaps, events and invocations, the
accounts and tokens they mention, *and* the checkpoint bump all sit inside a
single `BEGIN`/`COMMIT`. That is the whole crash story: there is no state in
which the checkpoint says a slot is done but its rows are missing.

Usually a commit is one slot. Under a backlog it is up to `SLOTS_PER_COMMIT`
(50), because the statements cost about the same either way — it is the round
trips that hurt. A chunk that fails stops the flush right there, so the
checkpoint never moves past a slot that was not written.

**Replaying a slot changes nothing.** Every table is keyed by something the
chain already guarantees unique:

| Table | Primary key |
| --- | --- |
| `slots` | `slot` |
| `transactions` | `signature` |
| `instructions` | `(signature, instruction_index, inner_index)` |
| `transfers` | `(signature, instruction_index, inner_index)` |
| `swaps` | `(signature, owner)` |
| `events` | `(signature, event_index)` |
| `invocations` | `(signature, invocation_index)` |
| `accounts` | `address` |
| `tokens` | `mint` |

`swaps` is keyed by owner because two signers can each swap in one transaction —
but one signer cannot swap twice in a way balances can tell apart, since their
movements would net together.

Every insert ends `ON CONFLICT DO NOTHING` and reports how many rows were
*actually* new, so the running totals stay honest across a replay.

Two things that look odd until you know why:

- `inner_index` is **-1** for a top-level instruction. It is part of a primary
  key, and a primary key column cannot be null. The API translates it back to
  `null` on the way out.
- Amounts are `NUMERIC(39, 0)`, not `BIGINT`. A token amount is an unsigned
  64-bit integer and `BIGINT` is signed — the top half of the range would
  overflow.

---

## Reading it back — `src/server/` and `src/app/api/`

The endpoint logic lives in the route file. `GET /api/swaps` is
`src/app/api/swaps/route.ts` — no indirection to chase. The shared parts are
`respond()`, pagination and validation in `server/http.ts`, and row-to-JSON in
`server/serialize.ts`.

Pagination avoids a `COUNT`: every list query asks for `limit + 1` rows, and if
the extra row comes back, `hasMore` is true.

### Why wallet activity is a UNION and not a view

A merged timeline over three tables is the obvious candidate for a database
view, and that is the wrong choice here.

A view would have to expose one `address` column covering all three kinds, which
for transfers means something like `COALESCE(source_owner, source)`. No index
covers a computed expression, so every wallet lookup would become a sequential
scan of the whole transfers table.

Written instead as a UNION of three separately-filtered queries, each branch
hits an index on the column it actually filters: `transfers` has one per party
column, `swaps` one on `owner`, and `transactions` a GIN index on `signers`.
Same result, and it stays fast as the tables grow.

Events have no wallet of their own — an event belongs to a program. In a wallet
timeline they are attributed to the signers of the transaction that produced
them, which makes the row mean "this wallet caused this program event".

---

## Watching — `src/lib/watch-store.ts` and `watchlist`

Pressing **Watch** on a program or wallet page has to cross a gap: the list
lives in a browser, and the LaserStream subscription lives in the worker
process. Those two cannot see each other — by design, the web app and the worker
share nothing but Postgres.

So there are two lists, and they are different on purpose:

| | Where | What it is |
| --- | --- | --- |
| IndexedDB | the browser | **this person's** list — no account, survives a reload, never leaves the machine |
| `watchlist` table | Postgres | the **union** of what every browser has asked for; the only thing the worker can read |

Adding writes both, locally first so the console responds immediately. If the
server call fails the local entry stays and the button says so, because that is
the true state: the list really does contain it and the indexer really is not
watching it. `/watching` shows the same distinction from both sides.

### Updating the subscription without reconnecting

The worker re-reads the table every `WATCHLIST_POLL_MS`. If the set changed it
rebuilds the request and calls `StreamHandle.write()`, which LaserStream accepts
on the open stream — so a new program takes effect on the next slot instead of
costing a reconnect, and a reconnect would mean a replay, a gap, or both.

Two details keep that cheap and safe:

- `subscriptionSet` sorts, so `sameSet` can decide in one pass whether anything
  actually changed. An unchanged watchlist costs one small query and no rewrite.
- `fromSlot` is sent only on the *first* request. Re-sending it on an update
  would ask the server to replay from there again, which is the opposite of what
  a live filter change should do.

A poll rather than `LISTEN`/`NOTIFY` because it keeps the two processes as
independent as they were designed to be: neither has to be running for the other
to start, and the query is a handful of rows.

### Two filters, because one of them is not enough

A watched address is added to both halves of the subscription:

**`transactions.accountInclude`** matches a transaction touching any listed
account, and a program id is an account like any other. On its own this is a
poor basis for watching: the default baseline is the System and Token programs,
which between them appear in nearly every transaction on the chain, so adding
one more address narrows nothing and looks like it did nothing.

**`accounts`** is the half that carries its weight. It asks a different
question — tell me when *this account itself* is written, whoever wrote it — and
the answer does not depend on the transaction baseline at all.

The two kinds subscribe through different fields:

| Kind | Field | Why |
| --- | --- | --- |
| wallet | `account: [address]` | the account itself is what changes |
| program | `owner: [address]` | a program account is executable and never changes; what is worth hearing about is the accounts it owns and writes |

Getting that backwards is a silent failure: subscribing to a program by
`account` produces a filter that is perfectly valid and delivers nothing for as
long as it is open. So is setting *both* — inside one filter `account` and
`owner` are ANDed, so asking for both means "the account whose pubkey is X and
whose owner is also X", which is true of nothing.

And `owner` is empty for a great many programs. A router or an aggregator owns
no mutable accounts at all: it operates on token and system accounts owned by
those programs. Its accounts filter is correct and permanently silent.

### Proving a watch is alive

Both of the above make a working program watch look broken, and the transaction
half is no help either — those transactions already arrive under the broad
baseline filter, so nothing about them says a watch caused them.

Every update names the filters it satisfied. So each watch is given a
*transaction filter of its own* alongside the baseline, matching only its own
address. It pulls in no data the baseline was not already delivering; what it
provides is a name. The worker tallies matches per filter and flushes them to
`watchlist.matched_count` on each commit — batched, because a busy watch matches
hundreds of updates a second and a write per update would cost more than the
indexing it reports on.

That count is what the console shows under the Watch button, and it is the only
direct evidence that a subscription is live rather than idle.

Writes land in `account_updates`, keyed by `(pubkey, slot, write_version)`.
`write_version` is monotonic per account, so it both orders two writes inside
one slot and makes a replay harmless. The account's data is not stored — only
its length — because the bytes can be megabytes and mean nothing without the
owning program's layout.

The queue between the stream and Postgres is capped. Watching a program means
every account it owns, which for a busy program is a firehose of its own; when
writes arrive faster than they can be stored the oldest are dropped, because an
account update is a snapshot of current state and the newest is the one worth
keeping.

---

## The console

Three pages — activity, swaps, events — each polling its endpoint. `usePoll` is
the only hook. It pauses while the browser tab is hidden, and
ignores a response that arrives after the URL changed, so a slow request cannot
overwrite fresher data.

Health is derived from one number: the age of the newest block indexed. Under a
minute is *live*, over five minutes means the stream has almost certainly
stopped.

---

## What happens when things break

| What | What happens |
| --- | --- |
| Stream drops briefly | The Helius SDK reconnects and replays; the buffer de-duplicates |
| Stream fails terminally | Worker logs the reason and exits; restarting resumes from the checkpoint |
| Commits cannot keep up | Above 2,000 buffered slots the worker explains and stops, rather than filling the heap and being killed |
| A transaction will not parse | Logged with its signature, counted in `skipped`, dropped |
| A slot will not commit | Logged; the checkpoint never moved, so the slot is indexed again later |
| The same slot written twice | Nothing changes — natural keys and `ON CONFLICT DO NOTHING` |
| Block metadata never arrives | The slot is written anyway once the chain is 24 slots past it |
| Logs are truncated mid-call | The invocation is kept, marked unsuccessful, with the lines that did arrive |
| A swap cannot be stated cleanly | No row, rather than a guessed one |
| The watchlist cannot be read | The previous subscription is kept; the next poll retries |
| A subscription rewrite is rejected | Logged; the stream carries on with the filter it had |
| Account writes outrun Postgres | The oldest queued are dropped and counted; the newest state is kept |
| A watched program is idle | No account writes, which is the honest answer — the filter is open and the program simply is not writing |
| Worker stopped with Ctrl-C | Buffered slots are committed before it exits |

---

## Running it in containers

`docker-compose.yml` runs the lot: Postgres, a one-shot `migrate`, the Next.js
server and the worker. Three things in it are less obvious than they look.

**node_modules is not shared with the host.** The LaserStream binding is a
native module with a per-platform build, so a macOS host's install is unusable
in a Linux container. The image installs its own, and an anonymous volume at
`/app/node_modules` stops the bind mount from covering it.

**The image installs with `npm install`, not `npm ci`.**
`@tailwindcss/oxide-wasm32-wasi` declares `@emnapi/core` and `@emnapi/runtime`
as dependencies, but npm never resolves that WASI branch on a macOS host, so the
committed lockfile has no entry for them and `npm ci` refuses outright.
`--omit=optional` is not a way out: the LaserStream binding is itself an
optional dependency, and dropping it leaves the worker unable to open a stream.

**The slim base image has no root certificates.** LaserStream is gRPC over TLS,
and without `ca-certificates` every connection fails as a bare `transport
error` naming neither TLS nor the cause. Installing them is the whole fix.

`migrate` runs as its own service rather than relying on the worker doing it,
so the console never comes up against a database with no tables. All three
application services share one image, because they run the same code and differ
only in their command.

---

## Adding to it

**A new transfer type.** Add a decoder to `src/chain/instructions.ts` and a
branch to `extractTransfers`. Nothing else changes — the schema already stores
any transfer.

**Decoding a program's events.** The bytes are already in `events.data`. Add an
IDL, match on `program_id` + `discriminator`, and deserialize. Nothing upstream
needs to change, which is the point of storing the payload whole.

**A new endpoint.** Add the query to `src/store/read.ts` and a `route.ts` under
`src/app/api/`. Wrap the body in `respond()`.

**A different data source.** Replace `src/core/stream.ts` and
`src/core/decode.ts`. Everything downstream works with the plain objects in
`src/domain/types.ts`, so as long as the new source produces those, the
extractors, buffer and store never learn about it.

**A schema change.** Add `migrations/002_whatever.sql`. Migrations run in
filename order and each one runs once, inside its own transaction.
