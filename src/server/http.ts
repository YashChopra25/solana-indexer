import bs58 from 'bs58';
import { refundIfBilled } from '../access/billing';
import { createLogger, errorMessage } from '../lib/logger';

/**
 * The bits of HTTP every route needs: turning a handler into a JSON response,
 * reading pagination out of the query string, and checking that an address or
 * signature really is one before it reaches SQL.
 */

const log = createLogger('api');

export class BadRequestError extends Error {}
export class NotFoundError extends Error {}
export class ConflictError extends Error {}

/**
 * Wraps a route so it always answers with JSON and never leaks a stack trace.
 * The errors above are the ones we expect; a query cut off by the database's
 * time limit is a 503 the caller can act on; anything else is a bug and
 * becomes a plain 500. Any error answer hands a keyed request back to the
 * customer's quota.
 */
export async function respond<T>(route: string, handler: () => Promise<T>): Promise<Response> {
  try {
    return Response.json(await handler());
  } catch (err) {
    await refundIfBilled();
    return errorResponse(route, err);
  }
}

function errorResponse(route: string, err: unknown): Response {
  if (err instanceof BadRequestError) return Response.json({ error: err.message }, { status: 400 });
  if (err instanceof NotFoundError) return Response.json({ error: err.message }, { status: 404 });
  if (err instanceof ConflictError) return Response.json({ error: err.message }, { status: 409 });

  // Postgres' query_canceled: the statement ran past its time limit.
  if ((err as { code?: string }).code === '57014') {
    log.warn('query timed out', { route });
    return Response.json(
      { error: 'this query is too broad to answer quickly; narrow it with a filter or a smaller page' },
      { status: 503, headers: { 'Retry-After': '5' } },
    );
  }

  log.error('unhandled error', { route, error: errorMessage(err) });
  return Response.json({ error: 'internal server error' }, { status: 500 });
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Deepest page a caller may ask for. OFFSET makes Postgres walk and discard
 * every row before it, so an unbounded one is a way to make a cheap query
 * arbitrarily expensive.
 */
const MAX_OFFSET = 10_000;

export interface Page {
  limit: number;
  offset: number;
}

interface Paginated<T> {
  data: T[];
  pagination: { limit: number; offset: number; count: number; hasMore: boolean };
}

/** Reads `limit` and `offset` from the query string, clamped to safe bounds. */
export function parsePage(params: URLSearchParams): Page {
  const limit = parseCount(params.get('limit'), 'limit') ?? DEFAULT_LIMIT;
  const offset = parseCount(params.get('offset'), 'offset') ?? 0;

  if (limit === 0) throw new BadRequestError('limit must be at least 1');
  if (offset > MAX_OFFSET) {
    throw new BadRequestError(`offset must be at most ${MAX_OFFSET}; narrow the query with a filter instead`);
  }

  return { limit: Math.min(limit, MAX_LIMIT), offset };
}

function parseCount(value: string | null, name: string): number | null {
  if (value === null || value === '') return null;

  // Number() would happily accept '1e3' and '  12  '; insist on plain digits.
  if (!/^\d+$/.test(value.trim())) {
    throw new BadRequestError(`${name} must be a non-negative integer`);
  }

  return Number(value.trim());
}

/**
 * List queries ask for one row more than the caller wanted. If it came back,
 * there is another page — which beats running a second COUNT.
 */
export function paginate<T>(rows: T[], page: Page): Paginated<T> {
  const hasMore = rows.length > page.limit;
  const data = hasMore ? rows.slice(0, page.limit) : rows;

  return {
    data,
    pagination: { limit: page.limit, offset: page.offset, count: data.length, hasMore },
  };
}

/** A Solana address is a base58 Ed25519 public key: 32 bytes. */
export function assertAddress(value: string, name = 'address'): string {
  return assertBase58(value, 32, name);
}

/** A signature is 64 bytes, same encoding. */
export function assertSignature(value: string): string {
  return assertBase58(value, 64, 'signature');
}

function assertBase58(value: string, bytes: number, name: string): string {
  let decoded: Uint8Array;

  try {
    decoded = bs58.decode(value);
  } catch {
    throw new BadRequestError(`${name} is not valid base58`);
  }

  if (decoded.length !== bytes) {
    throw new BadRequestError(`${name} must decode to ${bytes} bytes`);
  }

  return value;
}

/** An Anchor discriminator is 8 bytes, written as 16 hex characters. */
export function assertDiscriminator(value: string): string {
  if (!/^[0-9a-f]{16}$/i.test(value)) {
    throw new BadRequestError('discriminator must be 16 hex characters');
  }

  return value.toLowerCase();
}

/** One of a fixed set, or a 400 naming what was allowed. */
export function assertOneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  name: string,
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new BadRequestError(`${name} must be one of: ${allowed.join(', ')}`);
  }

  return value as T;
}

/** Reads an optional query parameter, treating an empty value as absent. */
export function optional(params: URLSearchParams, name: string): string | null {
  return params.get(name) || null;
}
