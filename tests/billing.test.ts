import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Task } from "../shared/types.js";
import { createSaasApp } from "../server/saas/server.js";
import { encodeForm, signWebhook, verifyWebhook } from "../server/saas/stripe.js";
import { ScriptedProvider, say, testConfig } from "./helpers.js";

const SECRET = "whsec_test_secret";
const PRICES = { starter: "price_starter_123", pro: "price_pro_456" };
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

interface StripeCall {
  path: string;
  params: URLSearchParams;
  idempotencyKey: string | null;
}

function setup(provider = new ScriptedProvider([])) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentopia-billing-"));
  const calls: StripeCall[] = [];
  const stripeFetch = (async (url: string, init: RequestInit) => {
    const p = new URL(url).pathname.replace("/v1", "");
    calls.push({ path: p, params: new URLSearchParams(String(init.body)), idempotencyKey: (init.headers as Record<string, string>)["idempotency-key"] ?? null });
    const body = p === "/customers" ? { id: "cus_123" } : p === "/checkout/sessions" ? { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" } : { url: "https://billing.stripe.com/p/session/bps_1" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const config = testConfig({ mode: "saas", dataDir, publicOrigin: "https://app.test", stripe: { secretKey: "sk_test_x", webhookSecret: SECRET, prices: PRICES } });
  const s = createSaasApp(config, { provider, startWorker: false, stripeFetch, timings: { retryBaseMs: 1, statusDecayMs: 5 } });
  cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  cleanups.push(() => s.stop());

  const webhook = (event: object, signature?: string) => {
    const payload = JSON.stringify(event);
    return s.app.request("/api/stripe/webhook", {
      method: "POST",
      headers: { host: "app.test", "content-type": "application/json", "stripe-signature": signature ?? signWebhook(payload, SECRET) },
      body: payload,
    });
  };
  const user = async (email: string) => {
    const res = await s.app.request("/api/auth/signup", { method: "POST", headers: { host: "app.test", "content-type": "application/json" }, body: JSON.stringify({ email, password: "correct horse battery" }) });
    const cookie = res.headers.get("set-cookie")!.split(";")[0];
    const id = s.accounts.findByEmail(email)!.account.id;
    const req = async (p: string, body?: unknown) => {
      const r = await s.app.request(p, { method: body === undefined ? "GET" : "POST", headers: { host: "app.test", "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: (await r.json()) as any };
    };
    return { id, req };
  };
  return { s, calls, webhook, user };
}

let seq = 0;
const subEvent = (type: string, sub: Record<string, unknown>, created = 1_700_000_000 + ++seq) => ({
  id: `evt_${seq}_${Math.random().toString(36).slice(2)}`,
  type,
  created,
  data: { object: { object: "subscription", id: "sub_1", customer: "cus_123", cancel_at_period_end: false, current_period_end: 1_800_000_000, ...sub } },
});

describe("Stripe webhook verification", () => {
  it("accepts a valid signature and rejects tampering and stale timestamps", () => {
    const payload = JSON.stringify({ id: "evt_1", type: "x", created: 1, data: { object: {} } });
    expect(verifyWebhook(payload, signWebhook(payload, SECRET), SECRET).id).toBe("evt_1");
    expect(() => verifyWebhook(payload.replace("evt_1", "evt_2"), signWebhook(payload, SECRET), SECRET)).toThrow(/does not match/);
    expect(() => verifyWebhook(payload, signWebhook(payload, "whsec_other"), SECRET)).toThrow(/does not match/);
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(() => verifyWebhook(payload, signWebhook(payload, SECRET, old), SECRET)).toThrow(/tolerance/);
    expect(() => verifyWebhook(payload, undefined, SECRET)).toThrow(/Missing/);
  });

  it("encodes nested params the way Stripe expects", () => {
    expect(decodeURIComponent(encodeForm({ line_items: [{ price: "p", quantity: 1 }], metadata: { user_id: "u" } }))).toBe("line_items[0][price]=p&line_items[0][quantity]=1&metadata[user_id]=u");
  });
});

describe("billing", () => {
  it("starts checkout for a plan id only, mapping it to the server's price", async () => {
    const { calls, user } = setup();
    const u = await user("pay@example.com");
    expect((await u.req("/api/billing/checkout", { plan: "pro", price: "price_free" })).status).toBe(400);
    expect((await u.req("/api/billing/checkout", { plan: "enterprise" })).status).toBe(400);
    const res = await u.req("/api/billing/checkout", { plan: "pro" });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.com/);
    const session = calls.find((c) => c.path === "/checkout/sessions")!;
    expect(session.params.get("line_items[0][price]")).toBe(PRICES.pro);
    expect(session.params.get("customer")).toBe("cus_123");
    expect(session.params.get("client_reference_id")).toBe(u.id);
    expect(session.params.get("success_url")).toBe("https://app.test/?billing=success");
    expect(calls.find((c) => c.path === "/customers")!.idempotencyKey).toBe(`customer-${u.id}`);
    // Checkout alone grants nothing: the plan changes only when Stripe confirms the subscription.
    expect((await u.req("/api/billing")).body.current.plan).toBe("trial");
  });

  it("applies verified subscription events once, in order, to the user's running town", async () => {
    const provider = new ScriptedProvider([say("done")]);
    const { s, webhook, user } = setup(provider);
    const u = await user("sub@example.com");
    await u.req("/api/billing/checkout", { plan: "starter" }); // links cus_123
    const town = s.towns.get(s.accounts.townOf(u.id)!);
    expect(town.config.monthlyBudgetUsd).toBe(2);

    // Unsigned or forged events change nothing.
    const forged = subEvent("customer.subscription.created", { status: "active", items: { data: [{ price: { id: PRICES.pro } }] } });
    expect((await webhook(forged, "t=1,v1=deadbeef")).status).toBe(400);
    expect((await u.req("/api/billing")).body.current.plan).toBe("trial");

    const created = subEvent("customer.subscription.created", { status: "active", metadata: { user_id: u.id }, items: { data: [{ price: { id: PRICES.pro } }] } });
    expect((await webhook(created)).status).toBe(200);
    let billing = (await u.req("/api/billing")).body.current;
    expect(billing).toMatchObject({ plan: "pro", status: "active", canRun: true });
    expect(town.config.monthlyBudgetUsd).toBe(25);
    expect(town.config.allowedModels).toContain("claude-opus-5-5");

    // A replayed event is acknowledged but not re-applied.
    expect((await (await webhook(created)).json()).duplicate).toBe(true);

    // Payment failure: grace period with a warning; work still runs.
    await webhook(subEvent("customer.subscription.updated", { status: "past_due", items: { data: [{ price: { id: PRICES.pro } }] } }));
    billing = (await u.req("/api/billing")).body.current;
    expect(billing).toMatchObject({ status: "past_due", canRun: true });
    expect(billing.warning).toMatch(/payment failed/i);

    // An older event delivered late can't roll state back.
    const stale = subEvent("customer.subscription.updated", { status: "active", items: { data: [{ price: { id: PRICES.starter } }] } }, 1_600_000_000);
    await webhook(stale);
    expect((await u.req("/api/billing")).body.current).toMatchObject({ plan: "pro", status: "past_due" });

    // Cancellation: new work is held.
    await webhook(subEvent("customer.subscription.deleted", { status: "canceled", items: { data: [{ price: { id: PRICES.pro } }] } }));
    billing = (await u.req("/api/billing")).body.current;
    expect(billing).toMatchObject({ status: "canceled", canRun: false });
    const task = (await u.req("/api/tasks", { agentId: "researcher", title: "After cancel", instructions: "Go" })).body as Task;
    await town.app.runner.tick();
    expect(town.app.store.getTask(task.id)!.status).toBe("queued");
    expect(provider.calls).toHaveLength(0);

    const audit = (await u.req("/api/account/audit")).body.map((a: { action: string }) => a.action);
    expect(audit.filter((a: string) => a === "billing.subscription")).toHaveLength(3);
  });

  it("ignores events whose customer doesn't match the user named in metadata", async () => {
    const { webhook, user } = setup();
    const victim = await user("victim@example.com");
    await victim.req("/api/billing/checkout", { plan: "starter" }); // victim's customer is cus_123
    const attack = subEvent("customer.subscription.created", { customer: "cus_attacker", status: "active", metadata: { user_id: victim.id }, items: { data: [{ price: { id: PRICES.pro } }] } });
    await webhook(attack);
    expect((await victim.req("/api/billing")).body.current.plan).toBe("trial");
  });

  it("opens the customer portal only for users with a billing account", async () => {
    const { user } = setup();
    const u = await user("portal@example.com");
    expect((await u.req("/api/billing/portal", {})).status).toBe(409);
    await u.req("/api/billing/checkout", { plan: "starter" });
    const res = await u.req("/api/billing/portal", {});
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/billing\.stripe\.com/);
  });
});
