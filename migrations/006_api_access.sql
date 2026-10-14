-- Paid access to the API.
--
-- A customer pays (recorded by hand, see `npm run admin`), gets one or more API
-- keys, and each request made with a key counts against the customer's monthly
-- quota. Nothing here talks to a payment provider: a payment row is simply the
-- operator writing down "they paid, and that covers them until this date".

CREATE TABLE IF NOT EXISTS customers (
    id         BIGSERIAL PRIMARY KEY,
    email      TEXT NOT NULL UNIQUE,
    name       TEXT,
    -- One of the plans in src/access/plans.ts. Kept as text rather than a
    -- foreign key: plans are code, not data, so changing a quota is a deploy.
    plan       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The payment history. A customer's access runs until the latest
-- `covers_until` among their payments, so there is no `paid_until` column to
-- keep in step: the history *is* the answer.
CREATE TABLE IF NOT EXISTS payments (
    id           BIGSERIAL PRIMARY KEY,
    customer_id  BIGINT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
    amount       NUMERIC NOT NULL,
    currency     TEXT NOT NULL,
    -- Whatever identifies the payment outside this system: a UPI reference, a
    -- bank transfer id, a transaction signature if they paid in SOL.
    reference    TEXT,
    paid_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    covers_until TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS payments_customer_idx ON payments (customer_id, covers_until DESC);

-- Only a hash of each key is stored. The key itself is printed once, when it is
-- created, and a database dump is then useless for calling the API.
--
-- SHA-256 rather than bcrypt: a key is 24 random bytes, not a password a person
-- chose, so there is nothing to brute-force and the lookup can be an index hit
-- on every request.
CREATE TABLE IF NOT EXISTS api_keys (
    id          BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
    key_hash    TEXT NOT NULL UNIQUE,
    -- The first few characters, so a listing can tell keys apart.
    prefix      TEXT NOT NULL,
    label       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at  TIMESTAMPTZ
);

-- Requests per customer per calendar month (UTC). The quota is per customer,
-- so every key a customer holds draws on the same row.
CREATE TABLE IF NOT EXISTS api_usage (
    customer_id BIGINT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
    month       DATE NOT NULL,
    requests    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (customer_id, month)
);
