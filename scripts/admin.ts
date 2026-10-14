import 'dotenv/config';
import { parseArgs } from 'node:util';
import { generateKey } from '../src/access/keys';
import { PLANS, isPlan } from '../src/access/plans';
import { readAmount, readCurrency, readEmail, readMonths, readPlan, readText } from '../src/access/input';
import { closePool } from '../src/store/pool';
import {
  addCustomer,
  addKey,
  addPayment,
  listCustomers,
  listKeys,
  revokeKeys,
  setPlan,
} from '../src/store/access';

/**
 * `npm run admin -- <command>` — the whole customer lifecycle, by hand.
 *
 * There is no payment provider. When someone pays you, you record it here and
 * their keys start (or keep) working until the date it covers. The /admin page
 * in the console does the same things with forms.
 */

const USAGE = `
npm run admin -- customer add <email> --plan starter|pro [--name "Acme"]
npm run admin -- customer plan <email> starter|pro
npm run admin -- payment add <email> --amount 20 [--currency USD] [--months 1] [--ref TXN123]
npm run admin -- key create <email> [--label production]
npm run admin -- key revoke <prefix>
npm run admin -- keys <email>
npm run admin -- customers
`.trim();

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    plan: { type: 'string' },
    name: { type: 'string' },
    amount: { type: 'string' },
    currency: { type: 'string', default: 'USD' },
    months: { type: 'string', default: '1' },
    ref: { type: 'string' },
    label: { type: 'string' },
  },
});

async function main(): Promise<void> {
  const [command, action, ...rest] = positionals;
  const route = [command, action].join(' ');

  switch (route) {
    case 'customer add': {
      const email = readEmail(need(rest[0], 'email'));
      const plan = readPlan(values.plan);
      await addCustomer(email, readText(values.name), plan);
      console.log(`added ${email} on ${plan}. Next: record a payment, then create a key.`);
      return;
    }

    case 'customer plan': {
      const email = readEmail(need(rest[0], 'email'));
      const plan = readPlan(rest[1]);
      if (!(await setPlan(email, plan))) fail(`no customer ${email}`);
      console.log(`${email} is now on ${plan}`);
      return;
    }

    case 'payment add': {
      const email = readEmail(need(rest[0], 'email'));
      const amount = readAmount(need(values.amount, '--amount'));
      const currency = readCurrency(values.currency);

      const until = await addPayment({
        email,
        amount,
        currency,
        months: readMonths(values.months),
        reference: readText(values.ref),
      });

      if (!until) fail(`no customer ${email}`);
      console.log(`recorded ${amount} ${currency} from ${email}; access runs until ${day(until)}`);
      return;
    }

    case 'key create': {
      const email = readEmail(need(rest[0], 'email'));
      const key = generateKey();

      if (!(await addKey(email, key, readText(values.label)))) fail(`no customer ${email}`);

      console.log(`API key for ${email} -- send it to them now, it is not stored and cannot be shown again:\n`);
      console.log(`  ${key.key}\n`);
      console.log(`They call the API with:  curl -H "Authorization: Bearer ${key.key}" <host>/api/swaps`);
      return;
    }

    case 'key revoke': {
      const prefix = need(rest[0], 'key prefix');
      const count = await revokeKeys(prefix);
      console.log(count ? `revoked ${count} key(s) starting ${prefix}` : `no live key starts ${prefix}`);
      return;
    }
  }

  // The two single-word commands.
  if (command === 'keys') {
    const keys = await listKeys(readEmail(need(action, 'email')));
    console.table(
      keys.map((key) => ({
        prefix: key.prefix,
        label: key.label ?? '',
        created: day(key.createdAt),
        status: key.revokedAt ? `revoked ${day(key.revokedAt)}` : 'live',
      })),
    );
    return;
  }

  if (command === 'customers') {
    const now = new Date();
    const customers = await listCustomers();
    console.table(
      customers.map((customer) => ({
        email: customer.email,
        plan: customer.plan,
        'paid until': customer.paidUntil ? day(customer.paidUntil) : 'never paid',
        status: customer.paidUntil && customer.paidUntil > now ? 'active' : 'expired',
        'requests this month': `${customer.requestsThisMonth} / ${quotaOf(customer.plan)}`,
        'live keys': customer.liveKeys,
      })),
    );
    return;
  }

  fail(USAGE);
}

function quotaOf(name: string): string {
  return isPlan(name) ? PLANS[name].monthlyRequests.toLocaleString() : '?';
}

function need(value: string | undefined, what: string): string {
  if (!value) fail(`missing ${what}\n\n${USAGE}`);
  return value;
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fail(message: string): never {
  throw new Error(message);
}

main()
  .catch((err) => {
    // A duplicate email is the one database error worth translating.
    const message = err instanceof Error ? err.message : String(err);
    console.error(message.includes('customers_email_key') ? 'that email is already a customer' : message);
    process.exitCode = 1;
  })
  .finally(closePool);
