'use server';

import { cookies } from 'next/headers';
import { refresh } from 'next/cache';
import {
  readAmount,
  readCurrency,
  readEmail,
  readMonths,
  readPlan,
  readText,
} from '@/access/input';
import { generateKey } from '@/access/keys';
import { SESSION_COOKIE, isAdminSession } from '@/access/session';
import { addCustomer, addKey, addPayment, revokeKeys, setPlan } from '@/store/access';

/**
 * What the /admin forms do. Each is the matching `npm run admin` command, run
 * from a form instead of a terminal, and answers with a line to show under it.
 */

export type ActionState = {
  ok?: string;
  error?: string;
  /** A newly created key. Shown once, by the form that asked for it. */
  key?: string;
} | null;

export async function addCustomerAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const email = readEmail(form.get('email'));
    const plan = readPlan(form.get('plan'));

    await addCustomer(email, readText(form.get('name')), plan);
    return { ok: `Added ${email} on ${plan}. Record a payment, then create a key.` };
  });
}

export async function recordPaymentAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const email = readEmail(form.get('email'));
    const amount = readAmount(form.get('amount'));
    const currency = readCurrency(form.get('currency'));

    const until = await addPayment({
      email,
      amount,
      currency,
      months: readMonths(form.get('months')),
      reference: readText(form.get('reference')),
    });

    if (!until) return { error: `No customer ${email}` };
    return { ok: `Recorded ${amount} ${currency}. Access runs until ${until.toISOString().slice(0, 10)}.` };
  });
}

export async function setPlanAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const email = readEmail(form.get('email'));
    const plan = readPlan(form.get('plan'));

    if (!(await setPlan(email, plan))) return { error: `No customer ${email}` };
    return { ok: `Now on ${plan}.` };
  });
}

export async function createKeyAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const email = readEmail(form.get('email'));
    const key = generateKey();

    if (!(await addKey(email, key, readText(form.get('label'))))) {
      return { error: `No customer ${email}` };
    }

    return { key: key.key };
  });
}

export async function revokeKeyAction(_state: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const prefix = String(form.get('prefix') ?? '');
    const count = await revokeKeys(prefix);

    return count ? { ok: `Revoked ${prefix}…` } : { error: `No live key starts ${prefix}` };
  });
}

/**
 * Checks the session, runs the change, and refreshes the page so the tables
 * show it. Any error becomes the form's message rather than an error page --
 * they are all things the operator typed wrong.
 */
async function run(change: () => Promise<ActionState>): Promise<ActionState> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isAdminSession(session)) return { error: 'Your session has expired. Sign in again.' };

  try {
    const result = await change();
    refresh();
    return result;
  } catch (err) {
    return { error: describe(err) };
  }
}

function describe(err: unknown): string {
  // Postgres' unique_violation: the only constraint a form can trip is the email.
  if ((err as { code?: string }).code === '23505') return 'That email is already a customer.';
  return err instanceof Error ? err.message : String(err);
}
