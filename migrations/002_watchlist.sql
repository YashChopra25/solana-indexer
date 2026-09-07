-- What the indexer has been asked to watch.
--
-- The browser keeps each user's own list in IndexedDB; this table is the union
-- of everything anyone has asked for, and it is the only thing the worker can
-- see. Without it the worker would have no way to learn what a browser wants,
-- since the two processes share nothing but this database.
--
-- The worker reads this table on a timer and, when the set changes, rewrites
-- its LaserStream subscription in place -- no reconnect, no replay, no gap.

CREATE TABLE IF NOT EXISTS watchlist (
    kind     TEXT NOT NULL CHECK (kind IN ('program', 'wallet')),
    address  TEXT NOT NULL,
    -- Whatever the person who added it called it. Never used for matching.
    label    TEXT,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (kind, address)
);

CREATE INDEX IF NOT EXISTS watchlist_added_idx ON watchlist (added_at DESC);
