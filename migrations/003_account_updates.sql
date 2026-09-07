-- Account writes for watched addresses.
--
-- A different source from `transactions`: a row lands here because the account
-- itself changed, whoever changed it. That is what makes watching mean
-- something when the transaction baseline is already broad enough to match
-- nearly every transaction on the chain.
--
-- `write_version` is monotonic per account, so it both orders two writes inside
-- one slot and completes a natural key -- replaying a slot re-writes the same
-- rows and changes nothing.

CREATE TABLE IF NOT EXISTS account_updates (
    pubkey        TEXT   NOT NULL,
    slot          BIGINT NOT NULL,
    write_version NUMERIC(39, 0) NOT NULL,
    owner         TEXT   NOT NULL,
    lamports      NUMERIC(39, 0) NOT NULL,
    executable    BOOLEAN NOT NULL DEFAULT FALSE,
    -- The account's contents are not stored: they can be megabytes, they mean
    -- nothing without the owning program's layout, and nothing here reads them.
    data_length   INTEGER NOT NULL DEFAULT 0,
    txn_signature TEXT,
    observed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (pubkey, slot, write_version)
);

CREATE INDEX IF NOT EXISTS account_updates_pubkey_idx ON account_updates (pubkey, slot DESC);
CREATE INDEX IF NOT EXISTS account_updates_slot_idx ON account_updates (slot DESC);
