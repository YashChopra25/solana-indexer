-- Symbols for the mints the indexer has seen.
--
-- The columns live on `tokens` rather than in a table of their own: there is
-- exactly one symbol per mint, and `tokens` already holds one row per mint with
-- its decimals, so a second table would only add a join.
--
-- `symbol` and `name` are nullable and usually null. Most mints an unfiltered
-- indexer meets are freshly minted and listed nowhere, so "no symbol" is the
-- ordinary case, not a failure -- which is why `checked_at` exists separately:
-- it distinguishes a mint nobody has looked up yet from one that was looked up
-- and genuinely has no listing. Without it every sync would re-ask about the
-- same few hundred unlisted mints forever.

ALTER TABLE tokens
    ADD COLUMN IF NOT EXISTS symbol     TEXT,
    ADD COLUMN IF NOT EXISTS name       TEXT,
    ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ;

-- The sync asks for the mints it has never checked, newest first. Partial, so
-- the index covers only the backlog and stays small once it is worked through.
CREATE INDEX IF NOT EXISTS tokens_unchecked_idx
    ON tokens (first_seen_slot DESC)
    WHERE checked_at IS NULL;
