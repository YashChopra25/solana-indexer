import Link from 'next/link';
import { PageHead, StatusRail } from './shell';

/** What a wallet or program page shows when its URL does not hold an address. */
export function InvalidAddress({ what, value }: { what: 'wallet' | 'app'; value: string }) {
  return (
    <>
      <StatusRail health="idle" detail="not an address" />
      <main id="main" className="mx-auto w-full max-w-7xl">
        <PageHead
          eyebrow={what === 'wallet' ? 'Wallet' : 'App (program)'}
          value="Not an address"
          tone="var(--signal)"
          explain={
            <>
              <span className="break-all">“{value}”</span> is not a Solana address. Addresses are
              32–44 characters of letters and digits. Check for a typo, or{' '}
              <Link href="/" className="underline underline-offset-4">
                search from the live feed
              </Link>
              .
            </>
          }
        />
      </main>
    </>
  );
}
