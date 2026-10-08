import type { Context, Hono } from "hono";
import { z } from "zod";
import type { Config } from "../config.js";
import { body } from "../api/security.js";
import type { Account, AccountsStore } from "./accounts.js";
import { PLANS, type PlanId } from "./plans.js";
import { StripeClient, StripeError, verifyWebhook, type StripeEvent } from "./stripe.js";
import type { Towns } from "./towns.js";

type Env = { Variables: { account: Account; townId: string; sessionToken: string } };

export interface BillingDeps {
  config: Config;
  accounts: AccountsStore;
  towns: Towns;
  /** Injected in tests; defaults to global fetch against api.stripe.com. */
  stripeFetch?: typeof fetch;
  clientIp: (c: Context) => string;
}

const PAID_PLANS = ["starter", "pro"] as const;
const LIVE_STATES = new Set(["active", "trialing", "past_due"]);

function planForPrice(config: Config, priceId: string | undefined): PlanId | null {
  if (!config.stripe || !priceId) return null;
  for (const id of PAID_PLANS) if (config.stripe.prices[id] === priceId) return id;
  return null;
}

/**
 * Stripe webhook. Mounted before session and CSRF middleware: Stripe is the
 * caller, and the signature over the raw body is the authentication.
 */
export function registerStripeWebhook(app: Hono<Env>, deps: BillingDeps): void {
  const { config, accounts, towns } = deps;
  app.post("/api/stripe/webhook", async (c) => {
    if (!config.stripe) return c.json({ error: "Billing is not configured" }, 404);
    const payload = await c.req.text();
    let event: StripeEvent;
    try {
      event = verifyWebhook(payload, c.req.header("stripe-signature"), config.stripe.webhookSecret);
    } catch (err) {
      accounts.audit(null, "billing.webhook_rejected", deps.clientIp(c), { reason: err instanceof Error ? err.message : String(err) });
      return c.json({ error: "Invalid signature" }, 400);
    }
    // Stripe delivers at least once and may replay: each event is applied once.
    if (!accounts.claimStripeEvent(event.id, event.type)) return c.json({ received: true, duplicate: true });
    try {
      handleEvent(event, deps);
    } catch (err) {
      accounts.forgetStripeEvent(event.id); // let Stripe's retry process it again
      console.error("[billing] webhook handling failed", event.type, err);
      return c.json({ error: "Webhook handling failed" }, 500);
    }
    return c.json({ received: true });
  });

  function handleEvent(event: StripeEvent, d: BillingDeps): void {
    const obj = event.data.object;
    switch (event.type) {
      case "checkout.session.completed": {
        const userId = typeof obj.client_reference_id === "string" ? obj.client_reference_id : null;
        const user = userId ? accounts.getUser(userId) : null;
        if (user && typeof obj.customer === "string" && !user.stripeCustomerId) accounts.setStripeCustomer(user.id, obj.customer);
        if (user) accounts.audit(user.id, "billing.checkout_completed", null, { session: obj.id });
        return;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const user = (typeof obj.metadata?.user_id === "string" && accounts.getUser(obj.metadata.user_id)) || (typeof obj.customer === "string" ? accounts.findByStripeCustomer(obj.customer) : null);
        if (!user) {
          console.warn(`[billing] ${event.type} for unknown customer ${obj.customer}`);
          return;
        }
        // Never trust metadata alone: the subscription's customer must be this user's customer.
        if (user.stripeCustomerId && obj.customer !== user.stripeCustomerId) {
          console.warn(`[billing] ${event.type}: customer mismatch for user ${user.id}`);
          return;
        }
        const item = obj.items?.data?.[0];
        const plan = planForPrice(d.config, item?.price?.id) ?? (PLANS[user.plan as PlanId] ? user.plan : "trial");
        const status = event.type === "customer.subscription.deleted" ? "canceled" : String(obj.status);
        const periodEnd = Number(obj.current_period_end ?? item?.current_period_end);
        const applied = accounts.applySubscription(user.id, {
          subscriptionId: String(obj.id),
          plan,
          status,
          currentPeriodEnd: Number.isFinite(periodEnd) ? new Date(periodEnd * 1000).toISOString() : null,
          cancelAtPeriodEnd: !!obj.cancel_at_period_end,
          eventCreated: event.created,
        });
        if (applied) {
          if (typeof obj.customer === "string" && !user.stripeCustomerId) accounts.setStripeCustomer(user.id, obj.customer);
          accounts.audit(user.id, "billing.subscription", null, { plan, status, event: event.type });
          towns.refreshEntitlements(user.id);
        }
        return;
      }
      case "invoice.payment_failed":
      case "invoice.paid": {
        const user = typeof obj.customer === "string" ? accounts.findByStripeCustomer(obj.customer) : null;
        if (user) accounts.audit(user.id, event.type === "invoice.paid" ? "billing.payment_succeeded" : "billing.payment_failed", null, { invoice: obj.id, amount: obj.amount_due });
        return;
      }
      default:
        return;
    }
  }
}

/** Plan info, Checkout and the customer portal (signed-in users). */
export function registerBilling(app: Hono<Env>, deps: BillingDeps): void {
  const { config, accounts, towns } = deps;
  const stripe = config.stripe ? new StripeClient(config.stripe.secretKey, deps.stripeFetch) : null;
  const origin = (c: Context) => config.publicOrigin ?? new URL(c.req.url).origin;

  app.get("/api/billing", (c) => {
    const account = accounts.getUser(c.get("account").id)!;
    const ent = towns.entitlements(account.id, true);
    return c.json({
      enabled: !!stripe,
      plans: Object.values(PLANS).map((p) => ({ id: p.id, label: p.label, priceUsdMonthly: p.priceUsdMonthly, dailyUsd: p.dailyUsd, monthlyUsd: p.monthlyUsd, perTaskUsd: p.perTaskUsd, concurrency: p.concurrency, models: p.models })),
      current: {
        plan: ent.plan.id,
        status: account.billingStatus,
        canRun: ent.canRun,
        reason: ent.reason,
        warning: ent.warning,
        trialEndsAt: ent.trialEndsAt,
        currentPeriodEnd: account.currentPeriodEnd,
        cancelAtPeriodEnd: account.cancelAtPeriodEnd,
      },
    });
  });

  // The browser names a plan; the server maps it to a price. A price id from the client is never accepted.
  const checkoutBody = z.object({ plan: z.enum(PAID_PLANS) }).strict();
  app.post("/api/billing/checkout", async (c) => {
    if (!stripe || !config.stripe) return c.json({ error: "Billing is not set up on this server yet." }, 409);
    const b = await body(c, checkoutBody);
    if (!b.ok) return b.res;
    const account = accounts.getUser(c.get("account").id)!;
    if (account.billingStatus && LIVE_STATES.has(account.billingStatus)) return c.json({ error: "You already have a subscription. Use Manage billing to change plans." }, 409);
    try {
      let customerId = account.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.post<{ id: string }>("/customers", { email: account.email, metadata: { user_id: account.id } }, `customer-${account.id}`);
        customerId = customer.id;
        accounts.setStripeCustomer(account.id, customerId);
      }
      const session = await stripe.post<{ url: string }>("/checkout/sessions", {
        mode: "subscription",
        customer: customerId,
        client_reference_id: account.id,
        line_items: [{ price: config.stripe.prices[b.data.plan], quantity: 1 }],
        subscription_data: { metadata: { user_id: account.id } },
        allow_promotion_codes: true,
        success_url: `${origin(c)}/?billing=success`,
        cancel_url: `${origin(c)}/?billing=cancelled`,
      });
      accounts.audit(account.id, "billing.checkout_started", deps.clientIp(c), { plan: b.data.plan });
      return c.json({ url: session.url });
    } catch (err) {
      console.error("[billing] checkout", err);
      return c.json({ error: err instanceof StripeError ? `Billing error: ${err.message}` : "Could not start checkout" }, 502);
    }
  });

  app.post("/api/billing/portal", async (c) => {
    if (!stripe) return c.json({ error: "Billing is not set up on this server yet." }, 409);
    const account = accounts.getUser(c.get("account").id)!;
    if (!account.stripeCustomerId) return c.json({ error: "No billing account yet — choose a plan first." }, 409);
    try {
      const session = await stripe.post<{ url: string }>("/billing_portal/sessions", { customer: account.stripeCustomerId, return_url: `${origin(c)}/` });
      accounts.audit(account.id, "billing.portal_opened", deps.clientIp(c));
      return c.json({ url: session.url });
    } catch (err) {
      console.error("[billing] portal", err);
      return c.json({ error: err instanceof StripeError ? `Billing error: ${err.message}` : "Could not open billing" }, 502);
    }
  });
}
