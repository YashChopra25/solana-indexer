'use client'; // Error boundaries must be Client Components

import Link from 'next/link';
import { PageHead } from '@/components/console/shell';

/**
 * What any page shows when rendering it fails -- most often the database being
 * unreachable while /admin loads. The details stay in the server log; the
 * digest is what to search it for.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main id="main" className="mx-auto w-full max-w-7xl">
      <PageHead
        eyebrow="Something went wrong"
        value="Temporarily unavailable"
        tone="var(--signal)"
        explain={
          <>
            This page could not be loaded. It is usually brief; try again in a moment.
            {error.digest && <span className="mt-2 block text-xs">Reference: {error.digest}</span>}
          </>
        }
      >
        <div className="mt-6 flex gap-4 text-sm">
          <button
            type="button"
            onClick={() => retry()}
            className="font-display rounded-xl px-5 py-2 font-600"
            style={{ background: 'var(--gradient)', color: 'var(--ground)' }}
          >
            Try again
          </button>
          <Link href="/" className="self-center underline underline-offset-4">
            Back to the live feed
          </Link>
        </div>
      </PageHead>
    </main>
  );
}
