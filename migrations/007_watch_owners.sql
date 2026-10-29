-- Who asked for each watch.
--
-- The console needs no login, so each browser carries a random id in its
-- `console` cookie. A watch stays in `watchlist` while at least one browser
-- still wants it: removing it from one browser drops only that browser's claim,
-- instead of switching it off for everyone else who added it too.

CREATE TABLE IF NOT EXISTS watch_owners (
    kind     TEXT NOT NULL,
    address  TEXT NOT NULL,
    visitor  TEXT NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (kind, address, visitor),
    FOREIGN KEY (kind, address) REFERENCES watchlist (kind, address) ON DELETE CASCADE
);

-- "How many watches does this browser hold", asked on every add.
CREATE INDEX IF NOT EXISTS watch_owners_visitor_idx ON watch_owners (visitor);

-- Entries from before ownership existed belong to the operator, so no browser
-- can remove them by accident; the operator still can.
INSERT INTO watch_owners (kind, address, visitor)
SELECT kind, address, 'operator' FROM watchlist
ON CONFLICT DO NOTHING;

-- Swaps are filtered by any venue the route passed through (`route_programs @>`),
-- which without this is a scan of the whole table.
CREATE INDEX IF NOT EXISTS swaps_route_programs_idx ON swaps USING GIN (route_programs);
