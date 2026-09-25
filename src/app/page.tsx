'use client';

import { Suspense } from 'react';
import { CounterRail, PageHead, SectionHead, StatusRail, toneOf } from '@/components/console/shell';
import { TransferFeed } from '@/components/console/feeds';
import { Lookup } from '@/components/console/lookup';
import { usePoll } from '@/hooks/use-poll';
import { classifyHealth, formatCount, formatLag } from '@/lib/format';
import type { IndexerStatus, Paginated, Transfer } from '@/lib/api-types';

/**
 * The index at a glance: how fresh it is, what it holds, and the payments
 * arriving now. The search field turns it into a wallet explorer, and the
 * glossary at the bottom is there for anyone who has never used a blockchain.
 */
export default function ActivityPage() {
  const status = usePoll<IndexerStatus>('/api/status', 2_000);
  const transfers = usePoll<Paginated<Transfer>>('/api/transfers?limit=20', 3_000);

  const indexer = status.data?.indexer;
  const totals = status.data?.totals;
  const health = classifyHealth(indexer?.lagSeconds ?? null, indexer?.slotsProcessed ?? 0);

  const behind = Math.max(
    0,
    (indexer?.estimatedTipSlot ?? 0) - (indexer?.lastProcessedSlot ?? 0),
  );

  return (
    <>
      <StatusRail
        health={health}
        detail={
          status.error && !status.data
            ? 'server unreachable'
            : `${formatCount(indexer?.slotsProcessed)} blocks read`
        }
      />

      <main className="mx-auto w-full max-w-7xl">
        <PageHead
          eyebrow="Solana, as it happens"
          value={indexer?.lastProcessedSlot ? `${formatLag(indexer.lagSeconds)} behind` : 'Waiting…'}
          tone={health === 'live' ? undefined : toneOf(health)}
          note={
            indexer?.lastProcessedSlot
              ? `latest block #${indexer.lastProcessedSlot.toLocaleString()} · ≈ ${behind.toLocaleString()} blocks to catch up`
              : 'no data yet — start the indexer with `npm run indexer`'
          }
          explain="This page reads the Solana blockchain live and turns raw blocks into things people recognise: who paid whom, who traded what, and which apps were used. The smaller the delay above, the closer to real time you are."
        />

        <CounterRail
          counters={[
            { label: 'Transactions', value: totals?.transactions ?? 0, hint: 'Actions submitted to the chain' },
            { label: 'Payments', value: totals?.transfers ?? 0, hint: 'SOL or tokens moving between wallets' },
            { label: 'Trades', value: totals?.swaps ?? 0, hint: 'One token swapped for another' },
            { label: 'App events', value: totals?.events ?? 0, hint: 'Messages apps log on-chain' },
            { label: 'Accounts', value: totals?.accounts ?? 0, hint: 'Wallet and app state changes' },
            { label: 'Tokens', value: totals?.tokens ?? 0, hint: 'Different currencies seen' },
          ]}
        />

        {/* Lookup reads `?q=`, which needs a Suspense boundary to prerender. */}
        <Suspense>
          <Lookup />
        </Suspense>

        <section className="px-4 pt-10 sm:px-8">
          <SectionHead
            title="Latest payments"
            hint="Money moving on Solana right now. Click any address to see everything that wallet has done."
          />

          <TransferFeed
            transfers={transfers.data?.data ?? []}
            loading={transfers.loading}
            error={transfers.error}
          />
        </section>

        <Glossary />
      </main>
    </>
  );
}

const TERMS = [
  {
    term: 'Wallet',
    text: 'An account that holds SOL and tokens, identified by a long address. Like a bank account number, but anyone can look it up.',
  },
  {
    term: 'Transaction',
    text: 'One signed request to the chain, such as "send 2 SOL" or "swap USDC for SOL". It either fully succeeds or fully fails.',
  },
  {
    term: 'Block (slot)',
    text: 'Solana groups transactions into a new block roughly every 0.4 seconds. The number counts up forever, like a page number.',
  },
  {
    term: 'Token',
    text: 'A currency that lives on Solana, such as USDC. SOL is the native one, used to pay network fees.',
  },
  {
    term: 'Program (app)',
    text: 'Code deployed on-chain. Exchanges, games and token contracts are all programs, and each one has its own address.',
  },
  {
    term: 'Indexer',
    text: 'This project. It listens to every block and saves the interesting parts in a database, so they can be searched in an instant.',
  },
];

function Glossary() {
  return (
    <section className="px-4 pb-20 pt-14 sm:px-8">
      <SectionHead title="New to Solana?" hint="The six words you need to read this page." />

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TERMS.map((item) => (
          <div key={item.term} className="panel px-5 py-4">
            <dt className="font-display font-600 grad-text inline-block">{item.term}</dt>
            <dd className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--dim)' }}>
              {item.text}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
