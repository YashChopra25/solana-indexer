/**
 * `npm run seed` — writes one made-up slot through the real extractors and the
 * real database code, so the console and the API have something to show without
 * a Helius key or a live stream.
 *
 * The slot contains one of each thing this indexer tracks: a SOL transfer, an
 * SPL transfer, a swap, Anchor events in both forms, and a failed transaction.
 *
 * It writes the same slot twice on purpose. The row counts printed before and
 * after are identical: that is the replay-safety guarantee, demonstrated rather
 * than asserted.
 */
import 'dotenv/config';
import { closePool, getPool, withTransaction } from '../src/store/pool';
import { runMigrations } from '../src/store/migrate';
import { persistSlots, readCheckpoint } from '../src/store/write';
import { indexTransaction } from '../src/extract/transaction';
import { SYSTEM_PROGRAM, TOKEN_PROGRAM } from '../src/chain/programs';
import type { RawTransaction, SlotBatch } from '../src/domain/types';
// The same made-up-data builders the tests use. Defining them twice is how the
// two drift apart.
import {
  address,
  eventCpiData,
  signature,
  systemTransferData,
  tokenTransferCheckedData,
} from '../tests/fixtures/build';

const SLOT = 350_000_100;
const SOL = 1_000_000_000n;
const FEE = 5_000n;

const alice = address('alice');
const bob = address('bob');
const aliceUsdc = address('alice-usdc');
const bobUsdc = address('bob-usdc');
const usdc = address('usdc');
const dex = address('sample-dex-program');
const anchorProgram = address('sample-anchor-program');

const base = {
  slot: SLOT,
  isVote: false,
  err: null,
  fee: FEE,
  computeUnits: 450n,
  loadedWritableAddresses: [],
  loadedReadonlyAddresses: [],
  numRequiredSignatures: 1,
  recentBlockhash: address('blockhash'),
  versioned: false,
  innerInstructions: [],
  logs: [],
  preBalances: [],
  postBalances: [],
  preTokenBalances: [],
  postTokenBalances: [],
} satisfies Omit<RawTransaction, 'signature' | 'index' | 'accountKeys' | 'instructions'>;

const transactions: RawTransaction[] = [
  // 1. A plain SOL transfer.
  {
    ...base,
    signature: signature('sample-sol-transfer'),
    index: 0,
    accountKeys: [alice, bob, SYSTEM_PROGRAM],
    instructions: [
      { programIdIndex: 2, accounts: [0, 1], data: systemTransferData(25n * SOL / 10n), stackHeight: null },
    ],
  },

  // 2. An SPL transfer, with the balance snapshots that name the owners.
  {
    ...base,
    signature: signature('sample-spl-transfer'),
    index: 1,
    accountKeys: [alice, aliceUsdc, usdc, bobUsdc, TOKEN_PROGRAM],
    instructions: [
      {
        programIdIndex: 4,
        accounts: [1, 2, 3, 0],
        data: tokenTransferCheckedData(1_250_000n, 6),
        stackHeight: null,
      },
    ],
    preTokenBalances: [
      { accountIndex: 1, mint: usdc, owner: alice, programId: TOKEN_PROGRAM, amount: 9_000_000n, decimals: 6 },
    ],
    postTokenBalances: [
      { accountIndex: 3, mint: usdc, owner: bob, programId: TOKEN_PROGRAM, amount: 1_250_000n, decimals: 6 },
    ],
  },

  // 3. A swap: alice gives 100 USDC and receives 1 SOL, through a DEX program.
  //    No instruction is decoded to find it -- only the balances either side.
  {
    ...base,
    signature: signature('sample-swap'),
    index: 2,
    accountKeys: [alice, aliceUsdc, usdc, dex],
    instructions: [
      { programIdIndex: 3, accounts: [0, 1, 2], data: new Uint8Array([7, 7, 7]), stackHeight: null },
    ],
    preBalances: [100n * SOL, 0n, 0n, 0n],
    postBalances: [101n * SOL - FEE, 0n, 0n, 0n],
    preTokenBalances: [
      { accountIndex: 1, mint: usdc, owner: alice, programId: TOKEN_PROGRAM, amount: 100_000_000n, decimals: 6 },
    ],
    postTokenBalances: [
      { accountIndex: 1, mint: usdc, owner: alice, programId: TOKEN_PROGRAM, amount: 0n, decimals: 6 },
    ],
    logs: [
      `Program ${dex} invoke [1]`,
      'Program log: instruction: Swap',
      `Program ${dex} consumed 34000 of 200000 compute units`,
      `Program ${dex} success`,
    ],
  },

  // 4. Anchor events, one emitted each way.
  {
    ...base,
    signature: signature('sample-events'),
    index: 3,
    accountKeys: [alice, anchorProgram],
    instructions: [
      { programIdIndex: 1, accounts: [0], data: new Uint8Array([1, 2, 3]), stackHeight: null },
      { programIdIndex: 1, accounts: [0], data: eventCpiData('0102030405060708'), stackHeight: 2 },
    ],
    logs: [
      `Program ${anchorProgram} invoke [1]`,
      'Program log: instruction: DoThing',
      `Program data: ${Buffer.concat([
        Buffer.from('aabbccddeeff0011', 'hex'),
        Buffer.alloc(16),
      ]).toString('base64')}`,
      `Program ${anchorProgram} success`,
    ],
  },

  // 5. A failed transaction: indexed, but contributing no transfers or swaps.
  {
    ...base,
    signature: signature('sample-failed'),
    index: 4,
    err: 'AQAAAA==',
    accountKeys: [alice, bob, SYSTEM_PROGRAM],
    instructions: [
      { programIdIndex: 2, accounts: [0, 1], data: systemTransferData(999n), stackHeight: null },
    ],
  },
];

const batch: SlotBatch = {
  slot: SLOT,
  block: {
    slot: SLOT,
    blockhash: address('sample-blockhash'),
    parentSlot: SLOT - 1,
    blockTime: Math.floor(Date.now() / 1000),
    blockHeight: 340_000_000,
    transactionCount: transactions.length,
  },
  transactions: transactions.map(indexTransaction),
};

async function rowCounts() {
  const { rows } = await getPool().query(
    `SELECT (SELECT COUNT(*) FROM slots)        AS slots,
            (SELECT COUNT(*) FROM transactions) AS transactions,
            (SELECT COUNT(*) FROM transfers)    AS transfers,
            (SELECT COUNT(*) FROM swaps)        AS swaps,
            (SELECT COUNT(*) FROM events)       AS events,
            (SELECT COUNT(*) FROM invocations)  AS invocations,
            (SELECT COUNT(*) FROM accounts)     AS accounts,
            (SELECT COUNT(*) FROM tokens)       AS tokens`,
  );

  return rows[0];
}

async function main() {
  await runMigrations();

  await withTransaction((client) => persistSlots(client, [batch]));
  const first = await rowCounts();

  // The same slot again: what a crash or a reconnect replay produces.
  await withTransaction((client) => persistSlots(client, [batch]));
  const second = await rowCounts();

  const checkpoint = await readCheckpoint(getPool());

  console.log('seeded slot      ', SLOT);
  console.log('after first write', first);
  console.log('after replay     ', second);
  console.log('checkpoint       ', checkpoint?.lastProcessedSlot);
  console.log('');
  console.log('try:');
  console.log(`  curl localhost:3000/api/swaps`);
  console.log(`  curl localhost:3000/api/events`);
  console.log(`  curl localhost:3000/api/wallets/${alice}/activity`);
  console.log(`  curl localhost:3000/api/programs/${dex}`);

  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});
