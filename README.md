# Solana Indexer

Streams Solana transactions and tracks four things: **token transfers**,
**swaps**, **wallet activity** and **program events**. Stores them in Postgres
and serves them over a REST API with a live console on top.

It is a learning project, built to be read. Every file is small, and there is no
framework in the middle of it — just a stream, a handful of pure extractors,
and SQL.

```
Helius LaserStream → extract → buffer by slot → Postgres → REST API → console
```

---

## Try it in two minutes

### Everything in Docker

```bash
docker compose up
```

Brings up Postgres, applies the migrations, then starts the API + console on
http://localhost:3000 and the ingestion worker. The source is bind-mounted, so
edits reload exactly as they do on the host.

Only the worker needs `HELIUS_API_KEY`; without it the console and API still
run, and the worker exits with one line saying why. It is deliberately not
restarted, so that line stays readable.

### Or on the host, with only the database in Docker

You need Node 20+ and Docker.

```bash
npm install
npm run db:up      # Postgres only, from the same compose file
npm run seed       # writes one made-up slot through the real code
npm run dev        # http://localhost:3000
```

`npm run seed` writes a slot containing one of everything — a SOL transfer, an
SPL transfer, a swap, Anchor events in both forms, and a failed transaction —
then writes the identical slot a second time and prints the row counts before
and after. They come out the same: that is the replay-safety guarantee, shown
rather than claimed.

To index the real chain you need a [Helius](https://dashboard.helius.dev) key
with LaserStream access:

```bash
cp .env.example .env     # put your key in HELIUS_API_KEY
npm run indexer          # in a second terminal, alongside npm run dev
```

---

## The four things it tracks

| | How it is found | Where it lands |
| --- | --- | --- |
| **Transfers** | Decoded from the instruction that performed them | `transfers` |
| **Swaps** | Inferred from balance movement — no DEX is decoded | `swaps` |
| **Program events** | Anchor's `emit!` and `emit_cpi!`, payloads kept as bytes | `events` |
| **Wallet activity** | The three above, merged per address | query-time union |
| **Watching** | A program or wallet you ask the indexer to follow | `watchlist` + IndexedDB |

### Transfers are decoded

Balance deltas would only show the net movement per account. The actual
instructions are decoded instead — System `Transfer`, SPL `Transfer` and
`TransferChecked`, including the ones invoked through CPI — so a transaction
that moves the same token three times produces three rows.

### Swaps are inferred

No DEX's instruction format is decoded anywhere in this project. A swap is
defined by its *effect*: one signer ended the transaction holding less of one
asset and more of another. That is true of Jupiter, Raydium, Orca, Meteora,
pump.fun and of venues that did not exist when this was written, and it stays
true when any of them ships a new program version.

The cost is that a multi-hop route is recorded as what went in and what came
out, not as its legs. The programs the route passed through are kept, so the
path is not lost entirely.

Four rules keep the noise out, and each is load-bearing:

1. **The owner must have signed.** A pool's token accounts move in exact
   opposition to the trader's, so without this every swap would be recorded
   twice — once forwards for the trader, once backwards for the pool.
2. **Some program beyond plumbing must have run.** Paying rent to open a token
   account spends SOL while tokens arrive, which is the exact shape of a small
   purchase.
3. **Small SOL movements are ignored when tokens also moved.** Fees and rent are
   SOL-denominated noise on top of a token trade.
4. **Wrapping is not swapping.** SOL to wrapped SOL is one asset in a different
   container, which is why native SOL and wSOL stay distinguishable.

### Watching is two lists, not one

Open any program or wallet page and press **Watch**. Two things happen, and they
are deliberately different things:

- the entry is saved in **this browser's IndexedDB** — your list, no account, it
  survives a reload and never leaves the machine;
- the entry is mirrored to a **`watchlist` table**, which is what the worker
  reads. Within a few seconds the worker rewrites its LaserStream subscription
  in place — `StreamHandle.write()`, so no reconnect, no replay and no gap.

That rewrite adds the address to **two** filters, and the second is what makes
watching worth anything:

| Filter | What it answers |
| --- | --- |
| `transactions.accountInclude` | transactions touching the address |
| `accounts` | **writes to the account itself**, whoever caused them |

The transactions filter alone is close to useless for watching, because the
default baseline (System + Token) already matches nearly every transaction on
the chain — adding one more address narrows nothing. An `accounts` subscription
asks a different question entirely, and its answer does not depend on the
baseline at all.

A wallet and a program subscribe differently:

- a **wallet** by `account` — tell me when this account changes;
- a **program** by `owner` — tell me when any account this program *owns*
  changes. A program account is executable and effectively never changes, so
  subscribing to it by `account` would report nothing, ever. Setting both is
  worse still: inside one filter they are ANDed, so the pair matches nothing.

Many programs own no mutable accounts — routers and aggregators work on token
and system accounts owned by *those* programs — so their accounts filter is
correct and permanently silent. Which is why each watch also gets a **transaction
filter of its own**: every update names the filters it matched, so the watch has
a match count of its own, shown under the Watch button. That count is the direct
evidence a subscription is live, and it works for every program regardless of
what it owns.

Account writes land in `account_updates` and appear on both pages under
**Account writes**. The account's contents are not stored: they can be
megabytes, they mean nothing without the owning program's layout, and nothing
here reads them — only the size, the lamports, the owner and the causing
signature.

They are separate because the worker cannot see IndexedDB: the two processes
share nothing but Postgres. So the table is the *union* of what every browser
has asked for, while IndexedDB is one person's list. `/watching` shows both
sides, including the two ways they can disagree — an entry saved locally that
never reached the indexer, and one the indexer holds that this browser has never
seen.

With the default `TRACKED_PROGRAM_IDS` the transaction half of watching changes
little, for the reason above; the accounts half works regardless. Narrow the
baseline and both halves start driving ingestion. The worker says which mode it
is in at startup.

### Most mints have no name, and that is the normal case

A mint account stores decimals and authorities, not a symbol, so the console
would otherwise have nothing but a 44-character address to show. `tokens` keeps
a `symbol` alongside the decimals it already had, filled in from a token list —
one outbound HTTP call, off the indexing path, and the only place this project
talks to anything but Helius and Postgres.

Expect it to answer "no" most of the time. Tracking System and SPL Token means
seeing **every** mint that exists, and the overwhelming majority are minutes old
and listed nowhere: on a sample of this indexer's own data, 17 of 751 mints
resolved — 2.3%. So the fallback is the ordinary path, not the error path, and
it is a shortened mint: `EPjF…Dt1v`.

That is also why the console reserves a **fixed width** for an asset label.
A shortened mint is always exactly nine characters, which is what most rows
show, so pinning symbols to the same width means a feed refreshing every two
seconds never nudges its columns sideways as named and unnamed tokens replace
each other. The full mint stays on the element's `title`: the symbol is what to
call the asset, the address is what identifies it.

A symbol never overrides the two SOL sentinels. Every token list calls the
wrapped-SOL mint "SOL", and deferring to that would collapse SOL and wSOL into
one label — destroying exactly the distinction that stops a wrap from being read
as a trade.

Symbols are hostile input: anyone can mint a token and name it anything. Bidi
overrides, zero-width characters and control characters are stripped before
storage, and what survives is capped — a token that renders identically to
another one is the whole point of the attack.

The worker sweeps for unnamed mints in the background every minute
(`TOKEN_SYNC_INTERVAL_MS=0` turns it off). `npm run tokens:sync` runs the same
sweep to completion, which is what you want against a database filled before
symbols existed.

### Events are kept as bytes

Anchor emits events two ways: `emit!` writes a `Program data:` line into the
logs, and `emit_cpi!` invokes the program against itself with the event as
instruction data behind a fixed marker. Both are captured.

Neither is decoded into named fields, because that needs the program's IDL and
this indexer holds none. What is stored is the 8-byte discriminator — which
identifies the event type — and the raw payload. That is enough to count events,
filter by type and correlate them with the transfers and swaps around them;
anyone who wants the fields has the bytes and can bring their own IDL.

Alongside them, every `Program X invoke` … `Program X success` span is stored in
`invocations` with the logs printed inside it, which is what makes an *unknown*
program's activity queryable at all.

`emit_cpi!` surfaces one event **twice** — as the self-CPI instruction and as a
`Program data:` log line with identical bytes. Both sources are read, because a
program using plain `emit!` produces only the log, but a payload found in both
places is counted once. Without that, every per-program event total doubles.

---

## How it fits together

Two processes that never talk to each other. They share one Postgres database
and nothing else, so either can be restarted on its own.

```
  npm run indexer                        npm run dev
  ───────────────                        ───────────
  src/worker.ts                          src/app/**
  gRPC → extract → SQL                   SQL → JSON → React
                    ╲                  ╱
                     ╲   Postgres     ╱
                      ╲______________╱
```

| Directory | What lives there |
| --- | --- |
| `src/chain/` | Solana primitives: byte encodings, program ids, the two decoders, mint symbols |
| `src/domain/` | Every shape the project works with |
| `src/extract/` | One pure extractor per tracked thing — no database, no clock |
| `src/core/` | The stream, the protobuf decoding, the slot buffer, the pipeline |
| `src/store/` | Connection pool, migrations, reads, writes |
| `src/server/` | Shared HTTP concerns and row-to-JSON |
| `src/app/api/` | One file per endpoint — the logic is in the route |
| `src/app/`, `src/components/` | The console — activity, swaps, events, watching, and per-program and per-wallet pages |
| `migrations/` | Numbered `.sql` files, applied in order |

`docs/how-it-works.md` walks through all of it in prose.

---

## The guarantee

**Rows and checkpoint commit together.** Transactions arrive out of order with
no "end of slot" marker, so they are buffered under their slot number until the
block metadata shows up. Finished slots are then written in one `BEGIN`/`COMMIT`
— their rows *and* the checkpoint that says how far we got. A crash halfway
through rolls back all of it, so those slots are simply indexed again. Normally
that is one slot per commit; when catching up after a reconnect it is up to 50,
which is the difference between draining a backlog and running out of memory
holding it.

**Replaying a slot changes nothing.** The stream replays after a reconnect and a
restart re-reads the slot it died on, so double writes are normal operation.
Every table is keyed by something the chain already guarantees is unique, and
every insert ends in `ON CONFLICT DO NOTHING`.

---

## API

| Endpoint | What you get |
| --- | --- |
| `GET /api/health` | Server is up and can reach Postgres |
| `GET /api/status` | Checkpoint, lag, totals |
| `GET /api/transfers` | Transfers, newest first |
| `GET /api/swaps` | Swaps, newest first |
| `GET /api/events` | Anchor events, newest first |
| `GET /api/transactions/:signature` | One transaction, fully expanded |
| `GET /api/wallets/:address/activity` | The merged timeline |
| `GET /api/wallets/:address/transfers` | Transfers on either side of an address |
| `GET /api/wallets/:address/swaps` | Swaps this wallet signed for |
| `GET /api/wallets/:address/events` | Events its transactions caused |
| `GET /api/wallets/:address/transactions` | Transactions touching the address |
| `GET /api/tokens/:mint` | A mint, and how much it has moved and traded |
| `GET /api/programs/:programId` | A program's footprint, event types, recent events and invocations |
| `GET /api/accounts/:address` | Writes to a watched account |
| `GET /api/watchlist` | What the indexer is watching |
| `POST /api/watchlist` | Watch a program or wallet — `{kind, address, label?}` |
| `DELETE /api/watchlist` | Stop watching — `{kind, address}` |

List endpoints take `limit` (default 25, max 100) and `offset`, and answer with
a `pagination` object. Filters:

- `/api/transfers` — `address`, `mint`, `kind=sol|spl`
- `/api/swaps` — `owner`, `mint` (either side), `program` (credited or routed through)
- `/api/events` — `program`, `discriminator`, `source=log|cpi`
- `/api/wallets/:address/activity` — `kind=transfer,swap,event`

```bash
curl localhost:3000/api/swaps
curl 'localhost:3000/api/events?source=cpi'
curl 'localhost:3000/api/wallets/<address>/activity?kind=swap,transfer'
```

Amounts come back as **strings** — lamport and token amounts are `u64` and can
be larger than a JavaScript number holds. Each carries a `symbol`, which is
`null` for most mints; `mint` is the identity, `symbol` is only a name.

---

## Configuration

Everything is in `src/config.ts` with a working default. The only value you have
to set is `HELIUS_API_KEY`.

| Variable | Default | What it does |
| --- | --- | --- |
| `HELIUS_API_KEY` | — | Required by the worker; the console runs without it |
| `DATABASE_URL` | local docker | Postgres connection string |
| `LASERSTREAM_ENDPOINT` | US East | Pick the region nearest you |
| `COMMITMENT` | `confirmed` | `processed` \| `confirmed` \| `finalized` |
| `TRACKED_PROGRAM_IDS` | System + Token | Which programs bring a transaction in |
| `WATCHLIST_POLL_MS` | 5000 | How often the worker re-reads the watchlist |
| `TOKEN_LIST_ENDPOINT` | Jupiter | Where mint symbols are looked up |
| `TOKEN_SYNC_INTERVAL_MS` | 60000 | Background symbol sweep; 0 turns it off |
| — | 20000 | `MAX_PENDING_ACCOUNT_UPDATES`, the account-write queue cap |

`TRACKED_PROGRAM_IDS` decides what gets ingested at all. The default pair covers
every SOL and SPL movement — and therefore every swap, since a balance cannot
change without one of them. Adding a DEX narrows nothing because it is already
covered; adding an unrelated program (governance, an NFT marketplace) brings its
events in too.

---

## Commands

```bash
npm run dev        # console + API on :3000
npm run indexer    # ingestion worker
npm run seed       # sample data, no Helius key needed
npm run tokens:sync # name the mints already indexed
npm test           # extractors, slot buffer, HTTP validation
npm run migrate    # apply migrations (the worker does this too)

npm run docker:up    # the whole project in containers
npm run docker:down  # stop it
npm run docker:build # rebuild the image after a dependency change

npm run db:up      # Postgres only, for the host workflow
npm run db:down    # stop it, keep the data
npm run db:reset   # stop it and delete the data
```

Browse the tables at http://localhost:8080 with
`docker compose --profile tools up -d adminer`.

`docker-compose.yml` is the only compose file: full stack by default, or
`up -d postgres` for the database alone, so the two workflows cannot drift
apart.

---

## What this is not

There is no CI, no Kubernetes, no cloud deployment, no autoscaling, no Kafka, no
IDL registry, and no per-DEX decoders. If the stream fails in a way the Helius
SDK cannot recover from, the worker prints why and exits — start it again and it
picks up from its checkpoint. That is the right amount of machinery for a project
meant to be read and run locally.
