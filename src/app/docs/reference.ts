/**
 * The API reference, as data. /docs renders it; keeping it apart from the page
 * means adding an endpoint is one entry here, not a new block of markup.
 *
 * Every sample is a real response from mainnet data, with long arrays cut
 * short. If a serializer in src/server/serialize.ts changes shape, the samples
 * here need the same change.
 */

export interface Param {
  name: string;
  in: 'path' | 'query';
  type: string;
  required?: boolean;
  description: string;
}

export interface Endpoint {
  id: string;
  path: string;
  title: string;
  summary: string;
  params: Param[];
  /** Path and query string of the sample request. */
  example: string;
  response: unknown;
  /** The object(s) in the response, linked to the Objects section. */
  returns: string;
  notes?: string[];
}

export interface Field {
  name: string;
  type: string;
  description: string;
}

export interface ObjectDoc {
  id: string;
  name: string;
  description: string;
  fields: Field[];
}

/* ------------------------------------------------------------------ */
/* Samples                                                             */
/* ------------------------------------------------------------------ */

const WALLET = '4DNCokssk17ieU9CBUnXoJAQ9iSCBwEByw4UP2ze1m8V';
const SIGNATURE =
  '2VpAzj4Ne5UFTTJKT52YeFfew8fZTt1s6JnUi1xj7XBGJB1tAjyQ7zSP3Dtkmd7xfbnnpVvdRpN6EK7fRWP9jVER';
const WSOL = 'So11111111111111111111111111111111111111112';
const PUMP = 'XuXkWAz3xRktfEjAfFDdkFksYBqFzet8JPkQxZMoRfi';

const SPL_TOKEN = { id: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', label: 'SPL Token' };
const DEX = { id: 'BQsAJYV4ZQDf683UrhA1MVLvbot9XYUfRHXxP1h13fPL', label: null };

const page = (limit: number, hasMore = true) => ({
  limit,
  offset: 0,
  count: limit,
  hasMore,
});

const TRANSFER = {
  signature: SIGNATURE,
  slot: 508411449,
  blockTime: '2026-10-07T09:36:39.000Z',
  instructionIndex: 0,
  innerIndex: 0,
  kind: 'spl',
  source: 'Fe5sThMPeoWi2xyAFiLoAAugqK6ADrjmDD1ELsoJ2Q5j',
  destination: '6Craih96SkPHY4tA92dZntxKUaVSEptx8fC9mkYbwVD4',
  sourceOwner: WALLET,
  destinationOwner: 'GcBBd25Sgu2w4EbL9otjxYZ56toWfNaQrKCtFG55CCZx',
  amount: '33300000',
  mint: WSOL,
  decimals: 9,
  symbol: 'SOL',
  program: SPL_TOKEN,
};

const SWAP = {
  signature: SIGNATURE,
  slot: 508411449,
  blockTime: '2026-10-07T09:36:39.000Z',
  owner: WALLET,
  in: { mint: WSOL, amount: '33300000', decimals: 9, symbol: 'SOL' },
  out: {
    mint: '3EHTHtBRcMmNwTsuq53tf8o5ZnHdsnTJPo6TMQT6U18w',
    amount: '3920992',
    decimals: 6,
    symbol: null,
  },
  program: DEX,
  route: [DEX],
};

const EVENT = {
  signature:
    '221CEQwMVjzxaMhMLFc83eA8tRSEGneLadWE8D1zXdqjvqWycuza5hpCyj8oF9QoZ6w3dCBU3ULybugQisUKCiM2',
  eventIndex: 0,
  slot: 508411558,
  blockTime: '2026-10-07T09:37:05.000Z',
  program: { id: PUMP, label: null },
  source: 'cpi',
  discriminator: 'bddb7fd34ee661ee',
  data: 'vdt/007mYe5E64eDPA4t4Z5F8B3NzB2lO8w/wBwvB3kiVaAq6OYrzRrhxjujUurnwtPfwDp6UZvK…',
};

const TRANSACTION = {
  signature: SIGNATURE,
  slot: 508411449,
  blockTime: '2026-10-07T09:36:39.000Z',
  transactionIndex: 5,
  success: true,
  err: null,
  fee: '5000',
  computeUnits: '61344',
  recentBlockhash: 'DNPmEtZjfQuiykQ73Rzs7jPiShcHV4nuVtRCU2efAouv',
  versioned: true,
  feePayer: WALLET,
  signers: [WALLET],
  accounts: [WALLET, '7nSLEFK3cuFBsr9wnV4NJRNwC23nJVTu4iVAx4PjDnE', '3CAPngg7WFAHsHNGgreYKcoRUVCtSXtPUP5mTgzjqEQt'],
  programs: [DEX, SPL_TOKEN],
  logs: [
    `Program ${DEX.id} invoke [1]`,
    `Program ${SPL_TOKEN.id} invoke [2]`,
    `Program ${SPL_TOKEN.id} success`,
  ],
};

const ACCOUNT_UPDATE = {
  pubkey: '3Bz9165oz1mgShrykq8uNWAaii6YBggjt9nNTaAMtow6',
  slot: 492488886,
  writeVersion: '4924888860000001',
  owner: { id: 'PoWSNH2hEZogtCg1Zgm51FnkmJperzYDgPK4fvs8taL', label: null },
  lamports: '810624',
  executable: false,
  dataLength: 0,
  signature:
    '26BAr2JhihnZdiFat9FaMjhSLCrjVBkF49Pr78EBKGCzRnWVAzEVYUwcdFKQ9UyP4eWyBzg7tqyLrBtHvpycVKpF',
  observedAt: '2026-09-03T12:06:20.253Z',
};

/* ------------------------------------------------------------------ */
/* Parameters shared by list endpoints                                 */
/* ------------------------------------------------------------------ */

const LIMIT: Param = {
  name: 'limit',
  in: 'query',
  type: 'integer',
  description: 'Rows per page. Default 25, maximum 100 (larger values are clamped).',
};

const OFFSET: Param = {
  name: 'offset',
  in: 'query',
  type: 'integer',
  description: 'Rows to skip. Default 0.',
};

const ADDRESS_PATH: Param = {
  name: 'address',
  in: 'path',
  type: 'base58 address',
  required: true,
  description: 'A wallet or token account (32 bytes, base58).',
};

const MINT_FILTER: Param = {
  name: 'mint',
  in: 'query',
  type: 'base58 address',
  description: 'Only this token mint.',
};

const KIND_FILTER: Param = {
  name: 'kind',
  in: 'query',
  type: '"sol" | "spl"',
  description: 'Native SOL transfers or SPL token transfers only.',
};

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

export const ENDPOINTS: Endpoint[] = [
  {
    id: 'transfers',
    path: '/api/transfers',
    title: 'List transfers',
    summary:
      'Every SOL and SPL token transfer, newest first. Includes transfers made inside other programs (CPI), so one transaction that moves a token three times gives three rows.',
    params: [
      { name: 'address', in: 'query', type: 'base58 address', description: 'Either side of the transfer, as the token account or the wallet that owns it.' },
      MINT_FILTER,
      KIND_FILTER,
      LIMIT,
      OFFSET,
    ],
    example: '/api/transfers?kind=spl&limit=1',
    returns: 'transfer',
    response: { data: [TRANSFER], pagination: page(1) },
  },
  {
    id: 'swaps',
    path: '/api/swaps',
    title: 'List swaps',
    summary:
      'Every swap, newest first. A swap is detected from balance changes: the signer ended the transaction with less of one token and more of another.',
    params: [
      { name: 'owner', in: 'query', type: 'base58 address', description: 'The wallet that swapped.' },
      { name: 'mint', in: 'query', type: 'base58 address', description: 'A token on either side of the trade.' },
      { name: 'program', in: 'query', type: 'base58 address', description: 'The program credited with the swap, or any venue the route passed through.' },
      LIMIT,
      OFFSET,
    ],
    example: `/api/swaps?owner=${WALLET}&limit=1`,
    returns: 'swap',
    response: { data: [SWAP], pagination: page(1) },
  },
  {
    id: 'events',
    path: '/api/events',
    title: 'List program events',
    summary:
      'Anchor events (emit! and emit_cpi!), newest first. The payload is returned as raw base64; decoding its fields needs the program\'s IDL.',
    params: [
      { name: 'program', in: 'query', type: 'base58 address', description: 'The program that emitted the event.' },
      { name: 'discriminator', in: 'query', type: '16 hex chars', description: 'The event type, as its 8-byte Anchor discriminator. Case-insensitive.' },
      { name: 'source', in: 'query', type: '"log" | "cpi"', description: 'log for emit!, cpi for emit_cpi!.' },
      LIMIT,
      OFFSET,
    ],
    example: `/api/events?program=${PUMP}&limit=1`,
    returns: 'event',
    response: { data: [EVENT], pagination: page(1) },
  },
  {
    id: 'transaction',
    path: '/api/transactions/:signature',
    title: 'Get a transaction',
    summary:
      'One transaction with everything extracted from it: its instructions, transfers, swaps, events and the tree of program calls.',
    params: [
      { name: 'signature', in: 'path', type: 'base58 signature', required: true, description: 'The transaction signature (64 bytes, base58).' },
    ],
    example: `/api/transactions/${SIGNATURE}`,
    returns: 'transaction',
    notes: ['Answers 404 if the transaction has not been indexed.'],
    response: {
      ...TRANSACTION,
      instructions: [
        {
          instructionIndex: 0,
          innerIndex: null,
          program: DEX,
          accounts: ['11111111111111111111111111111111', WALLET, 'GcBBd25Sgu2w4EbL9otjxYZ56toWfNaQrKCtFG55CCZx'],
          data: 'OQAAAAAAAAD2LQAAt9u4FaEB6gMBASAe/AEAAAAAAAEA',
          stackHeight: null,
        },
      ],
      transfers: [TRANSFER],
      swaps: [SWAP],
      events: [
        {
          ...EVENT,
          signature: SIGNATURE,
          slot: 508411449,
          blockTime: '2026-10-07T09:36:39.000Z',
          program: DEX,
          source: 'log',
          discriminator: '2100010000000000',
          data: 'IQABAAAAAAAAAAcAAQAAAAAAAQAAAQAAAAAATQEAAAAAAAAb3zsAAAAAAABNAQ…',
        },
      ],
      invocations: [
        {
          invocationIndex: 0,
          program: DEX,
          depth: 1,
          parentIndex: null,
          success: true,
          computeUnits: 61344,
          logs: ['Program data: IQABAAAAAAAAAAcAAQAAAAAAAQAAAQAAAAAATQEAAAAAAAAb3zsA…'],
        },
      ],
    },
  },
  {
    id: 'wallet-activity',
    path: '/api/wallets/:address/activity',
    title: 'Wallet activity',
    summary:
      'One timeline of a wallet\'s transfers, swaps and program events, newest first. Every row has the same shape, so you can render it without switching on kind first.',
    params: [
      ADDRESS_PATH,
      { name: 'kind', in: 'query', type: 'comma-separated list', description: 'Any of transfer, swap, event. Default: all three. Example: kind=swap,transfer' },
      LIMIT,
      OFFSET,
    ],
    example: `/api/wallets/${WALLET}/activity?limit=2`,
    returns: 'activity',
    response: {
      address: WALLET,
      data: [
        {
          kind: 'transfer',
          signature:
            'peRLBXJaXhvd86BjvdHyo5bXn9qQX383SVd3NZnFakZ5jkwNU3EX9X8UgthasfqnSDU7dkDS7hUakPnLtGC8qyk',
          slot: 508413968,
          blockTime: '2026-10-07T09:46:39.000Z',
          program: SPL_TOKEN,
          direction: 'out',
          primary: { mint: WSOL, amount: '34100000', decimals: 9, symbol: 'SOL' },
          counter: null,
          discriminator: null,
        },
        {
          kind: 'swap',
          signature: SIGNATURE,
          slot: 508411449,
          blockTime: '2026-10-07T09:36:39.000Z',
          program: DEX,
          direction: null,
          primary: SWAP.in,
          counter: SWAP.out,
          discriminator: null,
        },
      ],
      pagination: page(2),
    },
  },
  {
    id: 'wallet-transfers',
    path: '/api/wallets/:address/transfers',
    title: 'Wallet transfers',
    summary:
      'Transfers with this address on either side, as the token account or as the wallet that owns it. Same rows as /api/transfers?address=.',
    params: [ADDRESS_PATH, MINT_FILTER, KIND_FILTER, LIMIT, OFFSET],
    example: `/api/wallets/${WALLET}/transfers?limit=1`,
    returns: 'transfer',
    response: { address: WALLET, data: [TRANSFER], pagination: page(1) },
  },
  {
    id: 'wallet-swaps',
    path: '/api/wallets/:address/swaps',
    title: 'Wallet swaps',
    summary: 'Swaps this wallet signed for, newest first.',
    params: [ADDRESS_PATH, { ...MINT_FILTER, description: 'A token on either side of the trade.' }, LIMIT, OFFSET],
    example: `/api/wallets/${WALLET}/swaps?limit=1`,
    returns: 'swap',
    response: { address: WALLET, data: [SWAP], pagination: page(1) },
  },
  {
    id: 'wallet-events',
    path: '/api/wallets/:address/events',
    title: 'Wallet events',
    summary:
      'Program events from transactions this wallet signed. Rows use the activity shape, with kind "event".',
    params: [ADDRESS_PATH, LIMIT, OFFSET],
    example: `/api/wallets/${WALLET}/events?limit=1`,
    returns: 'activity',
    response: {
      address: WALLET,
      data: [
        {
          kind: 'event',
          signature: SIGNATURE,
          slot: 508411449,
          blockTime: '2026-10-07T09:36:39.000Z',
          program: DEX,
          direction: null,
          primary: null,
          counter: null,
          discriminator: '2100010000000000',
        },
      ],
      pagination: page(1),
    },
  },
  {
    id: 'wallet-transactions',
    path: '/api/wallets/:address/transactions',
    title: 'Wallet transactions',
    summary: 'Every indexed transaction that touched this address, newest first.',
    params: [ADDRESS_PATH, LIMIT, OFFSET],
    example: `/api/wallets/${WALLET}/transactions?limit=1`,
    returns: 'transaction',
    response: { address: WALLET, data: [TRANSACTION], pagination: page(1) },
  },
  {
    id: 'token',
    path: '/api/tokens/:mint',
    title: 'Get a token',
    summary: 'A token mint, and how much it has moved and traded.',
    params: [{ name: 'mint', in: 'path', type: 'base58 address', required: true, description: 'The token mint.' }],
    example: `/api/tokens/${WSOL}`,
    returns: 'token',
    notes: ['Answers 404 if the mint has not been seen.'],
    response: {
      mint: WSOL,
      decimals: 9,
      programId: SPL_TOKEN.id,
      firstSeenSlot: 492454966,
      lastSlot: 508411586,
      transferCount: 7694,
      swapCount: 733,
      updatedAt: '2026-10-07T09:37:12.996Z',
    },
  },
  {
    id: 'program',
    path: '/api/programs/:programId',
    title: 'Get a program',
    summary:
      'Everything known about one program: how often it ran, the swaps credited to it, the event types it emits (up to 25, most frequent first) and its latest events, calls and account writes.',
    params: [
      { name: 'programId', in: 'path', type: 'base58 address', required: true, description: 'The program id.' },
      { ...LIMIT, description: 'Rows in each of events, invocations and accountUpdates. Default 25, maximum 100.' },
      { ...OFFSET, description: 'Rows to skip in each of those lists.' },
    ],
    example: `/api/programs/${PUMP}?limit=1`,
    returns: 'program',
    notes: [
      'Answers 404 if the program has never been seen.',
      'accountUpdates is empty unless the operator is watching the program.',
    ],
    response: {
      program: { id: PUMP, label: null },
      invocationCount: 56832,
      eventCount: 29176,
      swapCount: 92,
      lastSlot: 508411605,
      eventTypes: [
        { discriminator: 'bddb7fd34ee661ee', source: 'cpi', count: 25010, lastSlot: 508411605 },
        { discriminator: '07fbba45c525978d', source: 'cpi', count: 1872, lastSlot: 498653752 },
      ],
      events: [EVENT],
      invocations: [
        {
          invocationIndex: 12,
          program: { id: PUMP, label: null },
          depth: 1,
          parentIndex: null,
          success: true,
          computeUnits: 73122,
          logs: ['Program log: Instruction: Buy'],
          signature:
            'ZAQjr31en8Vp8FLJJHgXAXoAi4taHWhXAeUfnibAukMW1Zt48jUYWzPvsaRyEwrVaorDcbkgBocQMof9cwf28P7',
          slot: 508411605,
        },
      ],
      accountUpdates: [],
    },
  },
  {
    id: 'account',
    path: '/api/accounts/:address',
    title: 'Account writes',
    summary:
      'Every recorded write to one account, newest first. Only accounts the operator watches are recorded; any other address returns an empty list, not an error.',
    params: [{ ...ADDRESS_PATH, description: 'The account (32 bytes, base58).' }, LIMIT, OFFSET],
    example: `/api/accounts/${ACCOUNT_UPDATE.pubkey}?limit=1`,
    returns: 'account-update',
    response: { address: ACCOUNT_UPDATE.pubkey, data: [ACCOUNT_UPDATE], pagination: page(1, false) },
  },
  {
    id: 'status',
    path: '/api/status',
    title: 'Indexer status',
    summary:
      'How current the data is. lagSeconds is the age of the newest indexed block; a few seconds is normal.',
    params: [],
    example: '/api/status',
    returns: 'status',
    response: {
      indexer: {
        lastProcessedSlot: 508411549,
        lastBlockTime: '2026-10-07T09:37:03.000Z',
        lagSeconds: 3,
        estimatedTipSlot: 508411557,
        slotsProcessed: 73103,
        updatedAt: '2026-10-07T09:37:03.888Z',
      },
      totals: {
        slots: 73104,
        transactions: 360334,
        transfers: 587854,
        swaps: 25833,
        events: 198523,
        accounts: 738369,
        tokens: 2368,
      },
    },
  },
];

/* ------------------------------------------------------------------ */
/* Response objects                                                    */
/* ------------------------------------------------------------------ */

const PROGRAM_FIELD = (name: string, what: string): Field => ({
  name,
  type: 'ProgramRef',
  description: what,
});

const TIME_FIELDS: Field[] = [
  { name: 'signature', type: 'string', description: 'The transaction it came from.' },
  { name: 'slot', type: 'integer', description: 'The slot (block) it landed in.' },
  { name: 'blockTime', type: 'ISO 8601 string | null', description: 'When that block was produced, in UTC.' },
];

export const OBJECTS: ObjectDoc[] = [
  {
    id: 'pagination',
    name: 'Pagination',
    description: 'Returned alongside data by every list endpoint.',
    fields: [
      { name: 'limit', type: 'integer', description: 'The page size used (after clamping).' },
      { name: 'offset', type: 'integer', description: 'Rows skipped.' },
      { name: 'count', type: 'integer', description: 'Rows in this page.' },
      { name: 'hasMore', type: 'boolean', description: 'Whether another page exists. Fetch it with offset + limit.' },
    ],
  },
  {
    id: 'program-ref',
    name: 'ProgramRef',
    description: 'A program. id identifies it; label is a readable name for well-known programs and null otherwise.',
    fields: [
      { name: 'id', type: 'string', description: 'Program address.' },
      { name: 'label', type: 'string | null', description: 'e.g. "SPL Token", "System".' },
    ],
  },
  {
    id: 'amount',
    name: 'Amount',
    description: 'A quantity of one token.',
    fields: [
      { name: 'mint', type: 'string', description: 'The token mint. This, not symbol, identifies the asset.' },
      { name: 'amount', type: 'string', description: 'Raw integer amount in the token\'s smallest unit. Divide by 10^decimals for the display value.' },
      { name: 'decimals', type: 'integer | null', description: 'The mint\'s decimals, when known.' },
      { name: 'symbol', type: 'string | null', description: 'Ticker from a public token list. Null for most mints.' },
    ],
  },
  {
    id: 'transfer',
    name: 'Transfer',
    description: 'One SOL or SPL token transfer instruction.',
    fields: [
      ...TIME_FIELDS,
      { name: 'instructionIndex', type: 'integer', description: 'Top-level instruction it belongs to.' },
      { name: 'innerIndex', type: 'integer | null', description: 'Position among that instruction\'s inner (CPI) instructions; null if top-level.' },
      { name: 'kind', type: '"sol" | "spl"', description: 'Native SOL or SPL token.' },
      { name: 'source', type: 'string', description: 'Sending account (a wallet for SOL, a token account for SPL).' },
      { name: 'destination', type: 'string', description: 'Receiving account.' },
      { name: 'sourceOwner', type: 'string | null', description: 'Wallet owning the source token account. Null for SOL transfers.' },
      { name: 'destinationOwner', type: 'string | null', description: 'Wallet owning the destination token account. Null for SOL transfers.' },
      { name: 'amount', type: 'string', description: 'Raw amount (lamports for SOL).' },
      { name: 'mint', type: 'string', description: 'Token mint. Native SOL uses So11111111111111111111111111111111111111111, distinct from wrapped SOL (…112).' },
      { name: 'decimals', type: 'integer | null', description: '9 for SOL.' },
      { name: 'symbol', type: 'string | null', description: 'See Amount.' },
      PROGRAM_FIELD('program', 'System or SPL Token program that performed it.'),
    ],
  },
  {
    id: 'swap',
    name: 'Swap',
    description: 'A trade of one token for another by one wallet in one transaction.',
    fields: [
      ...TIME_FIELDS,
      { name: 'owner', type: 'string', description: 'The wallet that swapped.' },
      { name: 'in', type: 'Amount', description: 'What the wallet gave up.' },
      { name: 'out', type: 'Amount', description: 'What the wallet received.' },
      PROGRAM_FIELD('program', 'The program credited with the swap (usually a DEX or aggregator).'),
      { name: 'route', type: 'ProgramRef[]', description: 'Every venue the trade passed through.' },
    ],
  },
  {
    id: 'event',
    name: 'Event',
    description: 'One Anchor program event.',
    fields: [
      { name: 'signature', type: 'string', description: 'The transaction that emitted it.' },
      { name: 'eventIndex', type: 'integer', description: 'Order within the transaction.' },
      { name: 'slot', type: 'integer', description: 'The slot it landed in.' },
      { name: 'blockTime', type: 'ISO 8601 string | null', description: 'Block time, UTC.' },
      PROGRAM_FIELD('program', 'The program that emitted it.'),
      { name: 'source', type: '"log" | "cpi"', description: 'emit! (log) or emit_cpi! (cpi).' },
      { name: 'discriminator', type: 'string', description: 'Event type: 8 bytes as 16 hex characters.' },
      { name: 'data', type: 'string', description: 'Base64 payload, discriminator included. (Shortened with … in these samples.)' },
    ],
  },
  {
    id: 'activity',
    name: 'Activity',
    description: 'One row of a wallet timeline. The fields that apply depend on kind.',
    fields: [
      { name: 'kind', type: '"transfer" | "swap" | "event"', description: 'What happened.' },
      ...TIME_FIELDS,
      PROGRAM_FIELD('program', 'The program involved.'),
      { name: 'direction', type: '"in" | "out" | null', description: 'Transfers only: whether value left (out) or reached (in) the wallet.' },
      { name: 'primary', type: 'Amount | null', description: 'Transfer: what moved. Swap: what was given up. Event: null.' },
      { name: 'counter', type: 'Amount | null', description: 'Swap only: what was received.' },
      { name: 'discriminator', type: 'string | null', description: 'Event only: the event type.' },
    ],
  },
  {
    id: 'transaction',
    name: 'Transaction',
    description:
      'A transaction. The single-transaction endpoint adds instructions, transfers, swaps, events and invocations.',
    fields: [
      ...TIME_FIELDS,
      { name: 'transactionIndex', type: 'integer', description: 'Position within the block.' },
      { name: 'success', type: 'boolean', description: 'Whether it succeeded.' },
      { name: 'err', type: 'string | null', description: 'The error, if it failed.' },
      { name: 'fee', type: 'string', description: 'Fee paid, in lamports.' },
      { name: 'computeUnits', type: 'string | null', description: 'Compute units consumed.' },
      { name: 'recentBlockhash', type: 'string | null', description: 'Blockhash it was signed against.' },
      { name: 'versioned', type: 'boolean', description: 'Versioned (v0) transaction or legacy.' },
      { name: 'feePayer', type: 'string | null', description: 'Account that paid the fee.' },
      { name: 'signers', type: 'string[]', description: 'Every signer.' },
      { name: 'accounts', type: 'string[]', description: 'Every account it referenced.' },
      { name: 'programs', type: 'ProgramRef[]', description: 'Programs it invoked.' },
      { name: 'logs', type: 'string[]', description: 'Program log lines.' },
      { name: 'instructions', type: 'Instruction[]', description: 'Single transaction only. Each with instructionIndex, innerIndex, program, accounts, data (base64) and stackHeight.' },
      { name: 'invocations', type: 'Invocation[]', description: 'Single transaction only. The program call tree: invocationIndex, program, depth, parentIndex, success, computeUnits, logs.' },
    ],
  },
  {
    id: 'token',
    name: 'Token',
    description: 'A mint the indexer has seen.',
    fields: [
      { name: 'mint', type: 'string', description: 'Mint address.' },
      { name: 'decimals', type: 'integer | null', description: 'Decimals.' },
      { name: 'programId', type: 'string | null', description: 'Token program that owns it.' },
      { name: 'firstSeenSlot', type: 'integer | null', description: 'First slot it appeared in.' },
      { name: 'lastSlot', type: 'integer | null', description: 'Latest slot it appeared in.' },
      { name: 'transferCount', type: 'integer', description: 'Transfers of this mint indexed.' },
      { name: 'swapCount', type: 'integer', description: 'Swaps involving this mint indexed.' },
      { name: 'updatedAt', type: 'ISO 8601 string | null', description: 'Last time these numbers changed.' },
    ],
  },
  {
    id: 'program',
    name: 'Program',
    description: 'What /api/programs/:programId returns.',
    fields: [
      PROGRAM_FIELD('program', 'The program itself.'),
      { name: 'invocationCount', type: 'integer', description: 'Times it was called.' },
      { name: 'eventCount', type: 'integer', description: 'Events it emitted.' },
      { name: 'swapCount', type: 'integer', description: 'Swaps credited to it.' },
      { name: 'lastSlot', type: 'integer | null', description: 'Latest slot it was seen in.' },
      { name: 'eventTypes', type: 'object[]', description: 'Distinct event types: discriminator, source, count, lastSlot.' },
      { name: 'events', type: 'Event[]', description: 'Latest events.' },
      { name: 'invocations', type: 'Invocation[]', description: 'Latest calls, each with its signature and slot.' },
      { name: 'accountUpdates', type: 'AccountUpdate[]', description: 'Latest account writes (watched programs only).' },
    ],
  },
  {
    id: 'account-update',
    name: 'AccountUpdate',
    description: 'One write to an account.',
    fields: [
      { name: 'pubkey', type: 'string', description: 'The account.' },
      { name: 'slot', type: 'integer', description: 'Slot of the write.' },
      { name: 'writeVersion', type: 'string', description: 'Orders writes within a slot.' },
      PROGRAM_FIELD('owner', 'Program that owns the account.'),
      { name: 'lamports', type: 'string', description: 'Balance after the write.' },
      { name: 'executable', type: 'boolean', description: 'Whether the account is a program.' },
      { name: 'dataLength', type: 'integer', description: 'Size of its data, in bytes.' },
      { name: 'signature', type: 'string | null', description: 'Transaction that caused it, when known.' },
      { name: 'observedAt', type: 'ISO 8601 string | null', description: 'When the indexer recorded it.' },
    ],
  },
  {
    id: 'status',
    name: 'Status',
    description: 'What /api/status returns.',
    fields: [
      { name: 'indexer.lastProcessedSlot', type: 'integer', description: 'Newest slot indexed.' },
      { name: 'indexer.lastBlockTime', type: 'ISO 8601 string | null', description: 'Its block time.' },
      { name: 'indexer.lagSeconds', type: 'integer | null', description: 'Age of the newest indexed block.' },
      { name: 'indexer.estimatedTipSlot', type: 'integer | null', description: 'Estimated current chain slot.' },
      { name: 'indexer.slotsProcessed', type: 'integer', description: 'Slots processed since tracking began.' },
      { name: 'indexer.updatedAt', type: 'ISO 8601 string | null', description: 'Last checkpoint.' },
      { name: 'totals.*', type: 'integer', description: 'Rows stored: slots, transactions, transfers, swaps, events, accounts, tokens.' },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export const ERRORS: { status: number; meaning: string; example: string }[] = [
  { status: 400, meaning: 'A parameter is invalid: a malformed address, an unknown filter value, limit=0.', example: 'limit must be at least 1' },
  { status: 401, meaning: 'No API key, or the key is unknown or revoked.', example: 'invalid or revoked API key' },
  { status: 402, meaning: 'The key is valid but the subscription is not paid up.', example: 'no active subscription: payment has lapsed or was never recorded' },
  { status: 403, meaning: 'Anything other than GET. API keys are read-only.', example: 'API keys are read-only' },
  { status: 404, meaning: 'The transaction, token or program has not been indexed.', example: 'token 1111…1111 is not indexed' },
  { status: 429, meaning: 'This month\'s request quota is used up. It resets on the 1st (UTC).', example: 'monthly request quota used up; it resets on the 1st (UTC)' },
  { status: 500, meaning: 'Something went wrong on our side. Retry later.', example: 'internal server error' },
];
