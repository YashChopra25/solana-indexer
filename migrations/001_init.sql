-- The whole schema.
--
-- Every table is keyed by something the chain already guarantees is unique --
-- a slot, a signature, a position within a transaction -- rather than by a
-- generated id. That is what makes replaying a slot harmless: the second write
-- conflicts with the first and does nothing.

CREATE TABLE IF NOT EXISTS slots (
    slot              BIGINT PRIMARY KEY,
    blockhash         TEXT,
    parent_slot       BIGINT,
    block_time        TIMESTAMPTZ,
    block_height      BIGINT,
    transaction_count INTEGER NOT NULL DEFAULT 0,
    indexed_count     INTEGER NOT NULL DEFAULT 0,
    indexed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS slots_block_time_idx ON slots (block_time DESC);

CREATE TABLE IF NOT EXISTS transactions (
    signature         TEXT PRIMARY KEY,
    slot              BIGINT NOT NULL,
    block_time        TIMESTAMPTZ,
    transaction_index INTEGER NOT NULL,
    success           BOOLEAN NOT NULL,
    err               TEXT,
    fee               BIGINT NOT NULL,
    compute_units     BIGINT,
    recent_blockhash  TEXT,
    versioned         BOOLEAN NOT NULL DEFAULT FALSE,
    fee_payer         TEXT,
    signers           TEXT[] NOT NULL DEFAULT '{}',
    accounts          TEXT[] NOT NULL DEFAULT '{}',
    program_ids       TEXT[] NOT NULL DEFAULT '{}',
    logs              TEXT[] NOT NULL DEFAULT '{}',
    indexed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transactions_slot_idx ON transactions (slot DESC, transaction_index);
CREATE INDEX IF NOT EXISTS transactions_fee_payer_idx ON transactions (fee_payer, slot DESC);
-- GIN turns "every transaction touching this address" into an index scan.
CREATE INDEX IF NOT EXISTS transactions_accounts_idx ON transactions USING GIN (accounts);
CREATE INDEX IF NOT EXISTS transactions_programs_idx ON transactions USING GIN (program_ids);
CREATE INDEX IF NOT EXISTS transactions_signers_idx ON transactions USING GIN (signers);

CREATE TABLE IF NOT EXISTS instructions (
    signature         TEXT NOT NULL REFERENCES transactions (signature) ON DELETE CASCADE,
    instruction_index INTEGER NOT NULL,
    -- -1 marks a top-level instruction; >= 0 is the position within the inner
    -- group. A primary key column cannot be null, hence the sentinel.
    inner_index       INTEGER NOT NULL,
    slot              BIGINT NOT NULL,
    program_id        TEXT NOT NULL,
    accounts          TEXT[] NOT NULL DEFAULT '{}',
    data              TEXT NOT NULL DEFAULT '',
    stack_height      INTEGER,
    PRIMARY KEY (signature, instruction_index, inner_index)
);

CREATE INDEX IF NOT EXISTS instructions_program_idx ON instructions (program_id, slot DESC);

-- ---------------------------------------------------------------------------
-- Transfers: decoded from the instruction that performed them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transfers (
    signature         TEXT NOT NULL REFERENCES transactions (signature) ON DELETE CASCADE,
    instruction_index INTEGER NOT NULL,
    inner_index       INTEGER NOT NULL,
    slot              BIGINT NOT NULL,
    block_time        TIMESTAMPTZ,
    kind              TEXT NOT NULL CHECK (kind IN ('sol', 'spl')),
    source            TEXT NOT NULL,
    destination       TEXT NOT NULL,
    source_owner      TEXT,
    destination_owner TEXT,
    -- NUMERIC, not BIGINT: a token amount is an unsigned 64-bit integer and
    -- BIGINT is signed, so the top half of the range would overflow.
    amount            NUMERIC(39, 0) NOT NULL,
    mint              TEXT NOT NULL,
    decimals          INTEGER,
    program_id        TEXT NOT NULL,
    PRIMARY KEY (signature, instruction_index, inner_index)
);

CREATE INDEX IF NOT EXISTS transfers_slot_idx ON transfers (slot DESC);
CREATE INDEX IF NOT EXISTS transfers_source_idx ON transfers (source, slot DESC);
CREATE INDEX IF NOT EXISTS transfers_destination_idx ON transfers (destination, slot DESC);
CREATE INDEX IF NOT EXISTS transfers_source_owner_idx ON transfers (source_owner, slot DESC);
CREATE INDEX IF NOT EXISTS transfers_dest_owner_idx ON transfers (destination_owner, slot DESC);
CREATE INDEX IF NOT EXISTS transfers_mint_idx ON transfers (mint, slot DESC);

-- ---------------------------------------------------------------------------
-- Swaps: inferred from balance movement, one row per owner per transaction.
--
-- The owner is part of the key because two signers can each swap in the same
-- transaction, but one signer cannot swap twice in a way that balances can
-- tell apart -- their movements would net together.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS swaps (
    signature      TEXT NOT NULL REFERENCES transactions (signature) ON DELETE CASCADE,
    owner          TEXT NOT NULL,
    slot           BIGINT NOT NULL,
    block_time     TIMESTAMPTZ,
    in_mint        TEXT NOT NULL,
    in_amount      NUMERIC(39, 0) NOT NULL,
    in_decimals    INTEGER,
    out_mint       TEXT NOT NULL,
    out_amount     NUMERIC(39, 0) NOT NULL,
    out_decimals   INTEGER,
    program_id     TEXT NOT NULL,
    route_programs TEXT[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (signature, owner)
);

CREATE INDEX IF NOT EXISTS swaps_slot_idx ON swaps (slot DESC);
CREATE INDEX IF NOT EXISTS swaps_owner_idx ON swaps (owner, slot DESC);
CREATE INDEX IF NOT EXISTS swaps_program_idx ON swaps (program_id, slot DESC);
CREATE INDEX IF NOT EXISTS swaps_in_mint_idx ON swaps (in_mint, slot DESC);
CREATE INDEX IF NOT EXISTS swaps_out_mint_idx ON swaps (out_mint, slot DESC);

-- ---------------------------------------------------------------------------
-- Program events: Anchor's, undecoded on purpose.
--
-- `discriminator` is the event type's first 8 bytes and `data` is the whole
-- payload. Without the program's IDL the fields have no names, so the bytes are
-- kept as they are rather than guessed at.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
    signature     TEXT NOT NULL REFERENCES transactions (signature) ON DELETE CASCADE,
    event_index   INTEGER NOT NULL,
    slot          BIGINT NOT NULL,
    block_time    TIMESTAMPTZ,
    program_id    TEXT NOT NULL,
    source        TEXT NOT NULL CHECK (source IN ('log', 'cpi')),
    discriminator TEXT NOT NULL,
    data          TEXT NOT NULL,
    PRIMARY KEY (signature, event_index)
);

CREATE INDEX IF NOT EXISTS events_slot_idx ON events (slot DESC);
CREATE INDEX IF NOT EXISTS events_program_idx ON events (program_id, slot DESC);
CREATE INDEX IF NOT EXISTS events_type_idx ON events (program_id, discriminator, slot DESC);

-- ---------------------------------------------------------------------------
-- One row per `Program X invoke` ... `Program X success` span, with its logs.
-- This is what makes an unknown program's activity queryable at all.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invocations (
    signature        TEXT NOT NULL REFERENCES transactions (signature) ON DELETE CASCADE,
    invocation_index INTEGER NOT NULL,
    slot             BIGINT NOT NULL,
    program_id       TEXT NOT NULL,
    depth            INTEGER NOT NULL,
    parent_index     INTEGER,
    success          BOOLEAN NOT NULL,
    compute_units    INTEGER,
    logs             TEXT[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (signature, invocation_index)
);

CREATE INDEX IF NOT EXISTS invocations_program_idx ON invocations (program_id, slot DESC);

CREATE TABLE IF NOT EXISTS tokens (
    mint            TEXT PRIMARY KEY,
    decimals        INTEGER,
    program_id      TEXT,
    first_seen_slot BIGINT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
    address         TEXT PRIMARY KEY,
    first_seen_slot BIGINT NOT NULL,
    last_seen_slot  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS accounts_last_seen_idx ON accounts (last_seen_slot DESC);

-- ---------------------------------------------------------------------------
-- How far the worker has got. Exactly one row, updated in the same transaction
-- as the slot's rows so it can never run ahead of them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS indexer_state (
    id                  TEXT PRIMARY KEY,
    last_processed_slot BIGINT NOT NULL DEFAULT 0,
    last_block_time     TIMESTAMPTZ,
    slots_processed     BIGINT NOT NULL DEFAULT 0,
    transactions_count  BIGINT NOT NULL DEFAULT 0,
    transfers_count     BIGINT NOT NULL DEFAULT 0,
    swaps_count         BIGINT NOT NULL DEFAULT 0,
    events_count        BIGINT NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO indexer_state (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;
