import { headers } from 'next/headers';
import { createLogger, errorMessage } from '../lib/logger';
import { refundRequest } from '../store/access';

/**
 * Customers pay for answers, not for mistakes.
 *
 * The proxy counts a keyed request against the quota before the route runs --
 * that is what keeps the quota exact when requests race. It then names the
 * customer in this header (after stripping any copy the client sent), and a
 * route that answers with an error hands the request back.
 */
export const BILLED_CUSTOMER_HEADER = 'x-billed-customer';

const log = createLogger('billing');

/** Called for any 4xx or 5xx answer; a no-op for requests no key paid for. */
export async function refundIfBilled(): Promise<void> {
  try {
    const customer = Number((await headers()).get(BILLED_CUSTOMER_HEADER));
    if (Number.isInteger(customer) && customer > 0) await refundRequest(customer);
  } catch (err) {
    // A failed refund costs the customer one request; never the response.
    log.warn('could not refund a failed request', { error: errorMessage(err) });
  }
}
