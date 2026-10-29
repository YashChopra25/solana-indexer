import Link from 'next/link';
import { PageHead } from '@/components/console/shell';

export default function NotFound() {
  return (
    <main id="main" className="mx-auto w-full max-w-7xl">
      <PageHead
        eyebrow="Not found"
        value="404"
        tone="var(--signal)"
        explain={
          <>
            There is no page here.{' '}
            <Link href="/" className="underline underline-offset-4">
              Go to the live feed
            </Link>{' '}
            or{' '}
            <Link href="/docs" className="underline underline-offset-4">
              read the API docs
            </Link>
            .
          </>
        }
      />
    </main>
  );
}
