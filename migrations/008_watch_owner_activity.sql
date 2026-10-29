-- When each browser last showed it still wants its watches.
--
-- Anyone can add a watch without signing in, so claims from browsers that
-- never come back would otherwise hold their place on the capped list forever.
-- A claim not refreshed for 30 days is dropped, and a watch nobody claims any
-- more goes with it; the operator's claims never expire.

ALTER TABLE watch_owners ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS watch_owners_last_seen_idx ON watch_owners (last_seen_at);
