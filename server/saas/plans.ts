/**
 * Subscription plans and the entitlements they grant. Entitlements are derived
 * on the server from the account record (later: the Stripe subscription), never
 * from anything the browser sends.
 *
 * Spend limits are in USD of model usage and are enforced by the existing budget
 * engine (worst-case reservation before every model call), per user town.
 */
export type PlanId = "trial" | "starter" | "pro";

export interface Plan {
  id: PlanId;
  label: string;
  /** List price per month in USD (0 for the trial). */
  priceUsdMonthly: number;
  dailyUsd: number;
  monthlyUsd: number;
  perTaskUsd: number;
  /** Tasks this town may run at the same time. */
  concurrency: number;
  /** Model new villagers start with. */
  defaultModel: string;
  /** Models villagers may use on this plan. */
  models: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  trial: {
    id: "trial",
    label: "Free trial",
    priceUsdMonthly: 0,
    dailyUsd: 0.75,
    monthlyUsd: 2,
    perTaskUsd: 0.4,
    concurrency: 1,
    defaultModel: "claude-sonnet-5-5",
    models: ["claude-haiku-5-5", "claude-sonnet-5-5"],
  },
  starter: {
    id: "starter",
    label: "Starter",
    priceUsdMonthly: 19,
    dailyUsd: 2,
    monthlyUsd: 8,
    perTaskUsd: 1,
    concurrency: 2,
    defaultModel: "claude-sonnet-5-5",
    models: ["claude-haiku-5-5", "claude-sonnet-5-5"],
  },
  pro: {
    id: "pro",
    label: "Pro",
    priceUsdMonthly: 49,
    dailyUsd: 6,
    monthlyUsd: 25,
    perTaskUsd: 2,
    concurrency: 3,
    defaultModel: "claude-sonnet-5-5",
    models: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"],
  },
};

export const TRIAL_DAYS = 14;

export interface Entitlements {
  plan: Plan;
  /** False when the trial has ended or a subscription lapsed: nothing new runs. */
  canRun: boolean;
  reason: string | null;
  /** Shown to the owner while work still runs (e.g. a failed payment being retried). */
  warning: string | null;
  trialEndsAt: string | null;
}

/** Subscription states that keep a paid plan's privileges. past_due = Stripe is retrying a failed payment (grace). */
const PAID_STATES = new Set(["active", "trialing", "past_due"]);

/**
 * Entitlements derive ONLY from server-side account state, which only verified
 * Stripe webhooks change. Nothing the browser sends can raise them.
 */
export function entitlementsFor(account: { plan: string; trialEndsAt: string | null; billingStatus?: string | null }, now = new Date()): Entitlements {
  const plan = PLANS[account.plan as PlanId] ?? PLANS.trial;
  if (plan.id !== "trial") {
    const status = account.billingStatus ?? "";
    if (!PAID_STATES.has(status)) {
      return { plan, canRun: false, reason: "Your subscription has ended. Choose a plan to keep your villagers working.", warning: null, trialEndsAt: null };
    }
    const warning = status === "past_due" ? "Your last payment failed. Update your card in Manage billing to keep your villagers working." : null;
    return { plan, canRun: true, reason: null, warning, trialEndsAt: null };
  }
  if (account.trialEndsAt && new Date(account.trialEndsAt) <= now) {
    return { plan, canRun: false, reason: "Your free trial has ended. Choose a plan to keep your villagers working.", warning: null, trialEndsAt: account.trialEndsAt };
  }
  return { plan, canRun: true, reason: null, warning: null, trialEndsAt: account.trialEndsAt };
}
