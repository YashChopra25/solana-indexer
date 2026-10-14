'use client';

import { useActionState, useState } from 'react';
import type { ActionState } from './actions';

/**
 * A form wired to one admin action: disables its button while the action runs
 * and shows what came back underneath. The only client code on /admin -- the
 * page itself renders on the server, straight from the database.
 */
export function ActionForm({
  action,
  submit,
  confirm: question,
  quiet,
  className = '',
  children,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  submit: string;
  /** Asked before submitting, for the one thing that cannot be undone. */
  confirm?: string;
  /** A small text button, for actions that sit inside a table row. */
  quiet?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (question && !window.confirm(question)) event.preventDefault();
      }}
      className={className}
    >
      <div className="flex flex-wrap items-end gap-2">
        {children}
        <button
          type="submit"
          disabled={pending}
          className={
            quiet
              ? 'text-xs underline-offset-4 hover:underline disabled:opacity-50'
              : 'font-display rounded-xl px-4 py-2 text-sm font-600 transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:opacity-50'
          }
          style={
            quiet
              ? { color: 'var(--signal)' }
              : { background: 'var(--gradient)', color: 'var(--ground)' }
          }
        >
          {pending ? 'Working…' : submit}
        </button>
      </div>

      {state?.error && (
        <p className="mt-2 text-xs" style={{ color: 'var(--signal)' }} aria-live="polite">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className="mt-2 text-xs" style={{ color: 'var(--deep)' }} aria-live="polite">
          {state.ok}
        </p>
      )}
      {state?.key && <NewKey value={state.key} />}
    </form>
  );
}

/** Only a hash is stored, so this is the one chance to copy the key. */
function NewKey({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      className="mt-3 rounded-xl border p-3 text-xs"
      style={{ borderColor: 'var(--deep)', background: 'color-mix(in oklab, var(--deep) 8%, transparent)' }}
    >
      <p style={{ color: 'var(--deep)' }}>
        Copy this key and send it to the customer now. It is not stored and cannot be shown again.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="break-all rounded-lg px-2 py-1" style={{ background: 'var(--ground)' }}>
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(value).then(() => setCopied(true), () => {});
          }}
          className="rounded-lg border px-2 py-1"
          style={{ borderColor: 'var(--rule-strong)' }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/** A labelled input, styled once for every admin form. */
export function Field({
  label,
  className = '',
  ...input
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`flex flex-col gap-1 text-xs ${className}`} style={{ color: 'var(--dim)' }}>
      {label}
      <input
        {...input}
        className="rounded-xl border bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--violet)]"
        style={{ borderColor: 'var(--rule-strong)', color: 'var(--ink)' }}
      />
    </label>
  );
}

export function PlanSelect({ plans, defaultValue }: { plans: string[]; defaultValue?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--dim)' }}>
      Plan
      <select
        name="plan"
        defaultValue={defaultValue}
        className="rounded-xl border px-3 py-2 text-sm outline-none"
        style={{ borderColor: 'var(--rule-strong)', color: 'var(--ink)', background: 'var(--panel)' }}
      >
        {plans.map((plan) => (
          <option key={plan} value={plan}>
            {plan}
          </option>
        ))}
      </select>
    </label>
  );
}
