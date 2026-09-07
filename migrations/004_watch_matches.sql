-- Proof that a watch is doing something.
--
-- Every update LaserStream sends names the filters it matched, so a watch can
-- be given its own named filter and its matches counted. Without this a watched
-- program looks inert: its transactions are already arriving under the broad
-- baseline filter, and the accounts subscription is silent for any program that
-- owns no mutable accounts -- which is most routers and aggregators.

ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS matched_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS last_matched_slot BIGINT;
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS last_matched_at TIMESTAMPTZ;
