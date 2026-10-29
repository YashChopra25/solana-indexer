import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PLANS, isPlan } from '@/access/plans';
import { SESSION_COOKIE, isAdminSession } from '@/access/session';
import { Badge, PageHead, SectionHead, StatusRail } from '@/components/console/shell';
import { listCustomers, listKeys, type CustomerSummary, type KeySummary } from '@/store/access';
import { ActionForm, Field, PlanSelect } from './action-form';
import {
  addCustomerAction,
  createKeyAction,
  recordPaymentAction,
  revokeKeyAction,
  setPlanAction,
} from './actions';

// Reads customers and usage from Postgres on every visit.
export const dynamic = 'force-dynamic';

const PLAN_NAMES = Object.keys(PLANS);

/**
 * /admin — the customers who pay for the API, and everything you do for them:
 * add them, record what they paid, change their plan, issue and revoke keys.
 * The same operations as `npm run admin`, with forms.
 */
export default async function AdminPage() {
  // Checked here as well as in the proxy: this page lists every customer, so
  // it must not depend on one layer getting every path variation right.
  if (!isAdminSession((await cookies()).get(SESSION_COOKIE)?.value)) redirect('/login?next=/admin');

  const customers = await listCustomers();
  const keys = await Promise.all(customers.map((customer) => listKeys(customer.email)));

  const now = new Date();
  const active = customers.filter((customer) => isActive(customer, now)).length;

  return (
    <>
      <StatusRail
        health="live"
        detail={`${customers.length} customers · ${active} paid up`}
      />

      <main id="main" className="mx-auto w-full max-w-7xl pb-16">
        <PageHead
          eyebrow="Paying customers"
          value={active.toLocaleString()}
          note={`of ${customers.length} customers`}
          explain="Customers call the API with a key. A key works while a payment covers today and the customer is under their plan's monthly request quota. Payments are recorded here by hand; nothing is charged automatically."
        />

        <section className="px-4 sm:px-8">
          <SectionHead title="Add a customer" hint="Then record their payment and create a key." />
          <ActionForm action={addCustomerAction} submit="Add customer" className="panel mt-4 p-4">
            <Field label="Email" name="email" type="email" required placeholder="ana@acme.dev" />
            <Field label="Name (optional)" name="name" placeholder="Acme" />
            <PlanSelect plans={PLAN_NAMES} />
          </ActionForm>
        </section>

        <section className="mt-10 px-4 sm:px-8">
          <SectionHead
            title="Customers"
            hint={PLAN_NAMES.map((name) => `${name}: ${quotaOf(name)} requests/month`).join(' · ')}
          />

          {customers.length === 0 && (
            <p className="panel mt-4 p-6 text-sm" style={{ color: 'var(--dim)' }}>
              No customers yet. Add one above.
            </p>
          )}

          <div className="mt-4 flex flex-col gap-4">
            {customers.map((customer, i) => (
              <CustomerCard key={customer.email} customer={customer} keys={keys[i]} now={now} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

function CustomerCard({
  customer,
  keys,
  now,
}: {
  customer: CustomerSummary;
  keys: KeySummary[];
  now: Date;
}) {
  const paid = isActive(customer, now);
  const quota = isPlan(customer.plan) ? PLANS[customer.plan].monthlyRequests : 0;
  const used = quota ? Math.min(customer.requestsThisMonth / quota, 1) : 0;

  return (
    <article className="panel p-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-lg font-600 break-all">{customer.email}</h3>
          <p className="mt-1 text-xs" style={{ color: 'var(--dim)' }}>
            {customer.name ?? 'No name'} · {customer.plan} plan
          </p>
        </div>

        <div className="flex flex-col items-end gap-1 text-xs">
          <Badge tone={paid ? 'var(--deep)' : 'var(--signal)'}>
            {paid ? 'Active' : customer.paidUntil ? 'Expired' : 'Never paid'}
          </Badge>
          <span style={{ color: 'var(--dim)' }}>
            {customer.paidUntil ? `${paid ? 'Paid until' : 'Lapsed'} ${day(customer.paidUntil)}` : 'No payment recorded'}
          </span>
        </div>
      </header>

      <div className="mt-4">
        <div className="flex justify-between text-xs" style={{ color: 'var(--dim)' }}>
          <span>Requests this month</span>
          <span className="tnum">
            {customer.requestsThisMonth.toLocaleString()} / {quotaOf(customer.plan)}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--rule)' }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${used * 100}%`,
              background: used >= 1 ? 'var(--signal)' : 'var(--gradient)',
            }}
          />
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <ActionForm action={recordPaymentAction} submit="Record payment">
          <input type="hidden" name="email" value={customer.email} />
          <Field label="Amount" name="amount" required inputMode="decimal" placeholder="20" className="w-24" />
          <Field label="Currency" name="currency" defaultValue="USD" className="w-20" />
          <Field label="Months" name="months" type="number" min={1} max={36} defaultValue={1} className="w-20" />
          <Field label="Reference (optional)" name="reference" placeholder="UPI / txn id" className="w-40" />
        </ActionForm>

        <div className="flex flex-wrap items-start gap-5">
          <ActionForm action={setPlanAction} submit="Change plan">
            <input type="hidden" name="email" value={customer.email} />
            <PlanSelect plans={PLAN_NAMES} defaultValue={customer.plan} />
          </ActionForm>

          <ActionForm action={createKeyAction} submit="Create key" className="min-w-0 flex-1">
            <input type="hidden" name="email" value={customer.email} />
            <Field label="Key label (optional)" name="label" placeholder="production" className="w-40" />
          </ActionForm>
        </div>
      </div>

      <KeyList keys={keys} />
    </article>
  );
}

function KeyList({ keys }: { keys: KeySummary[] }) {
  if (keys.length === 0) {
    return (
      <p className="mt-5 text-xs" style={{ color: 'var(--dim)' }}>
        No keys yet.
      </p>
    );
  }

  return (
    <ul className="mt-5 divide-y border-t text-sm" style={{ borderColor: 'var(--rule)' }}>
      {keys.map((key) => (
        <li
          key={key.prefix + key.createdAt.toISOString()}
          className="flex flex-wrap items-center justify-between gap-3 py-2.5"
          style={{ borderColor: 'var(--rule)' }}
        >
          <span className="flex flex-wrap items-center gap-3">
            <code style={{ opacity: key.revokedAt ? 0.5 : 1 }}>{key.prefix}…</code>
            {key.label && <span style={{ color: 'var(--dim)' }}>{key.label}</span>}
            <span className="text-xs" style={{ color: 'var(--dim)' }}>
              created {day(key.createdAt)}
            </span>
          </span>

          {key.revokedAt ? (
            <span className="text-xs" style={{ color: 'var(--dim)' }}>
              revoked {day(key.revokedAt)}
            </span>
          ) : (
            <ActionForm
              action={revokeKeyAction}
              submit="Revoke"
              quiet
              confirm={`Revoke ${key.prefix}…? Requests using it will start failing immediately.`}
            >
              <input type="hidden" name="prefix" value={key.prefix} />
            </ActionForm>
          )}
        </li>
      ))}
    </ul>
  );
}

function isActive(customer: CustomerSummary, now: Date): boolean {
  return customer.paidUntil !== null && customer.paidUntil > now;
}

function quotaOf(plan: string): string {
  return isPlan(plan) ? PLANS[plan].monthlyRequests.toLocaleString() : '?';
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}
