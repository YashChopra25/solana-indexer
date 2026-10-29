'use client'; // Error boundaries must be Client Components

import './globals.css';

/**
 * Last resort: shown only if the root layout itself fails to render, so it
 * brings its own <html> and <body> and depends on nothing else.
 */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center p-8" style={{ background: 'var(--ground)', color: 'var(--ink)' }}>
        <main id="main" className="max-w-md text-center">
          <h1 className="text-2xl font-bold">The console could not load</h1>
          <p className="mt-3 text-sm" style={{ color: 'var(--dim)' }}>
            This is usually brief. The API keeps working while it is.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className="mt-6 rounded-xl px-5 py-2 text-sm font-semibold"
            style={{ background: 'var(--gradient)', color: 'var(--ground)' }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
