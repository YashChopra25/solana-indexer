/**
 * What a customer can buy. Change a quota here and every customer on that plan
 * gets it on the next request -- the database stores only the plan's name.
 */
export const PLANS = {
  starter: { monthlyRequests: 100_000 },
  pro: { monthlyRequests: 1_000_000 },
} as const;

export type PlanName = keyof typeof PLANS;

export function isPlan(value: string): value is PlanName {
  return Object.hasOwn(PLANS, value);
}
