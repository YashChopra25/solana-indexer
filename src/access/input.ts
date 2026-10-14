import { PLANS, isPlan, type PlanName } from './plans';

/**
 * The rules for what an operator types, shared by `npm run admin` and the
 * /admin page so the two cannot disagree. Each one returns the clean value or
 * throws with a message fit to show as-is.
 */

export function readEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('enter a valid email address');
  return email;
}

export function readPlan(value: unknown): PlanName {
  const plan = String(value ?? '');
  if (!isPlan(plan)) throw new Error(`plan must be one of: ${Object.keys(PLANS).join(', ')}`);
  return plan;
}

/** Kept as a string: NUMERIC in Postgres, and no float rounding on the way. */
export function readAmount(value: unknown): string {
  const amount = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) throw new Error('amount must be a number, like 20 or 19.99');
  return amount;
}

export function readMonths(value: unknown): number {
  const months = Number(value);
  if (!Number.isInteger(months) || months < 1 || months > 36) {
    throw new Error('months must be a whole number from 1 to 36');
  }
  return months;
}

export function readCurrency(value: unknown): string {
  const currency = String(value ?? '').trim().toUpperCase() || 'USD';
  if (!/^[A-Z]{3,5}$/.test(currency)) throw new Error('currency must be a code like USD, INR or SOL');
  return currency;
}

/** Optional free text: trimmed, capped, and null when empty. */
export function readText(value: unknown, max = 80): string | null {
  return String(value ?? '').trim().slice(0, max) || null;
}
