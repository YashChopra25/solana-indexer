/**
 * The operator's way into /admin, where customers and API keys are managed.
 * The rest of the console is open; customers use the API with a key.
 */

const MESSAGE: Record<string, string> = {
  wrong: 'That password is not right.',
  unset: 'ADMIN_PASSWORD is not set on the server, so nobody can sign in.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next = '/admin', error } = await searchParams;

  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-16">
      <form
        method="post"
        action="/api/login"
        className="w-full max-w-sm rounded-2xl border p-8"
        style={{ borderColor: 'var(--rule-strong)', background: 'var(--panel)' }}
      >
        <h1 className="font-display text-2xl font-700 tracking-tight">
          Solana <span className="grad-text">Indexer</span>
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--dim)' }}>
          Sign in to manage customers and API keys.
        </p>

        <input type="hidden" name="next" value={next} />

        <label className="mt-6 block text-xs uppercase tracking-[0.2em]" style={{ color: 'var(--dim)' }}>
          Password
          <input
            type="password"
            name="password"
            required
            autoFocus
            autoComplete="current-password"
            className="mt-2 block w-full rounded-xl border bg-transparent px-4 py-2.5 text-sm normal-case tracking-normal outline-none focus:border-[var(--violet)]"
            style={{ borderColor: 'var(--rule-strong)', color: 'var(--ink)' }}
          />
        </label>

        {error && (
          <p className="mt-3 text-sm" style={{ color: 'var(--signal)' }}>
            {MESSAGE[error] ?? 'Could not sign in.'}
          </p>
        )}

        <button
          type="submit"
          className="font-display mt-6 w-full rounded-xl px-5 py-2.5 text-sm font-600 transition-transform hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: 'var(--gradient)', color: 'var(--ground)' }}
        >
          Sign in
        </button>

        <p className="mt-6 text-center text-xs" style={{ color: 'var(--dim)' }}>
          Calling the API with a key?{' '}
          <a href="/docs" className="underline underline-offset-4" style={{ color: 'var(--cyan)' }}>
            Read the API docs
          </a>
        </p>
      </form>
    </main>
  );
}
