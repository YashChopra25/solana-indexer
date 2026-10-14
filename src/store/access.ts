import { getPool } from './pool';
import type { KeyRecord } from '../access/keys';
import type { PlanName } from '../access/plans';

/**
 * Customers, payments, API keys and usage. The proxy calls the first two
 * functions on every API request; the rest are for `npm run admin`.
 */

/** The calendar month a request falls in, in UTC, as the usage table keys it. */
const THIS_MONTH = `date_trunc('month', NOW() AT TIME ZONE 'UTC')::date`;

export async function findKey(hash: string): Promise<KeyRecord | null> {
  const { rows } = await getPool().query<{
    customer_id: number;
    plan: string;
    revoked_at: Date | null;
    paid_until: Date | null;
  }>(
    `SELECT k.customer_id, c.plan, k.revoked_at,
            (SELECT MAX(covers_until) FROM payments p WHERE p.customer_id = c.id) AS paid_until
     FROM api_keys k
     JOIN customers c ON c.id = k.customer_id
     WHERE k.key_hash = $1`,
    [hash],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    customerId: row.customer_id,
    plan: row.plan,
    revokedAt: row.revoked_at,
    paidUntil: row.paid_until,
  };
}

/**
 * Counts one request against this month's quota, and returns the new total --
 * or null if the quota was already used up, in which case nothing is counted.
 *
 * The check and the increment are one statement. Reading the count first and
 * writing it after would let two concurrent requests both see "one left".
 */
export async function countRequest(customerId: number, quota: number): Promise<number | null> {
  const { rows } = await getPool().query<{ requests: number }>(
    `INSERT INTO api_usage (customer_id, month, requests)
     VALUES ($1, ${THIS_MONTH}, 1)
     ON CONFLICT (customer_id, month)
       DO UPDATE SET requests = api_usage.requests + 1
       WHERE api_usage.requests < $2
     RETURNING requests`,
    [customerId, quota],
  );

  return rows[0]?.requests ?? null;
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export async function addCustomer(email: string, name: string | null, plan: PlanName): Promise<void> {
  await getPool().query('INSERT INTO customers (email, name, plan) VALUES ($1, $2, $3)', [
    email,
    name,
    plan,
  ]);
}

/** Returns whether a customer with that email exists. */
export async function setPlan(email: string, plan: PlanName): Promise<boolean> {
  const { rowCount } = await getPool().query('UPDATE customers SET plan = $2 WHERE email = $1', [
    email,
    plan,
  ]);

  return (rowCount ?? 0) > 0;
}

/**
 * Records a payment and returns the date access now runs until, or null if
 * there is no such customer.
 *
 * Paying early extends from the current end date rather than from today, so a
 * customer who renews a week before expiry does not lose that week.
 */
export async function addPayment(payment: {
  email: string;
  amount: string;
  currency: string;
  months: number;
  reference: string | null;
}): Promise<Date | null> {
  const { rows } = await getPool().query<{ covers_until: Date }>(
    `INSERT INTO payments (customer_id, amount, currency, reference, covers_until)
     SELECT c.id, $2, $3, $4,
            GREATEST(NOW(), (SELECT MAX(covers_until) FROM payments p WHERE p.customer_id = c.id))
              + make_interval(months => $5::int)
     FROM customers c
     WHERE c.email = $1
     RETURNING covers_until`,
    [payment.email, payment.amount, payment.currency, payment.reference, payment.months],
  );

  return rows[0]?.covers_until ?? null;
}

/** Returns false if there is no customer with that email. */
export async function addKey(
  email: string,
  key: { hash: string; prefix: string },
  label: string | null,
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `INSERT INTO api_keys (customer_id, key_hash, prefix, label)
     SELECT id, $2, $3, $4 FROM customers WHERE email = $1`,
    [email, key.hash, key.prefix, label],
  );

  return (rowCount ?? 0) > 0;
}

/** Revokes every live key starting with `prefix`; returns how many. */
export async function revokeKeys(prefix: string): Promise<number> {
  const { rowCount } = await getPool().query(
    'UPDATE api_keys SET revoked_at = NOW() WHERE prefix = $1 AND revoked_at IS NULL',
    [prefix],
  );

  return rowCount ?? 0;
}

export interface CustomerSummary {
  email: string;
  name: string | null;
  plan: string;
  paidUntil: Date | null;
  requestsThisMonth: number;
  liveKeys: number;
}

export async function listCustomers(): Promise<CustomerSummary[]> {
  const { rows } = await getPool().query<{
    email: string;
    name: string | null;
    plan: string;
    paid_until: Date | null;
    requests: number | null;
    live_keys: number;
  }>(
    `SELECT c.email, c.name, c.plan,
            (SELECT MAX(covers_until) FROM payments p WHERE p.customer_id = c.id) AS paid_until,
            (SELECT requests FROM api_usage u WHERE u.customer_id = c.id AND u.month = ${THIS_MONTH}) AS requests,
            (SELECT COUNT(*) FROM api_keys k WHERE k.customer_id = c.id AND k.revoked_at IS NULL) AS live_keys
     FROM customers c
     ORDER BY c.created_at`,
  );

  return rows.map((row) => ({
    email: row.email,
    name: row.name,
    plan: row.plan,
    paidUntil: row.paid_until,
    requestsThisMonth: row.requests ?? 0,
    liveKeys: Number(row.live_keys),
  }));
}

export interface KeySummary {
  prefix: string;
  label: string | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export async function listKeys(email: string): Promise<KeySummary[]> {
  const { rows } = await getPool().query<{
    prefix: string;
    label: string | null;
    created_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT k.prefix, k.label, k.created_at, k.revoked_at
     FROM api_keys k JOIN customers c ON c.id = k.customer_id
     WHERE c.email = $1
     ORDER BY k.created_at`,
    [email],
  );

  return rows.map((row) => ({
    prefix: row.prefix,
    label: row.label,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }));
}
