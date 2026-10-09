import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal Stripe client over the REST API (no SDK dependency): form-encoded
 * requests, idempotency keys, and webhook signature verification following
 * https://docs.stripe.com/webhooks#verify-manually.
 */

export class StripeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Params = Record<string, unknown>;

/** Encode nested params the way Stripe expects: a[b][0][c]=v. */
export function encodeForm(params: Params, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === "object") parts.push(encodeForm(item as Params, `${key}[${i}]`));
        else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === "object") {
      parts.push(encodeForm(v as Params, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

export class StripeClient {
  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async post<T = Record<string, unknown>>(path: string, params: Params, idempotencyKey?: string): Promise<T> {
    const res = await this.fetchImpl(`https://api.stripe.com/v1${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: encodeForm(params),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
    if (!res.ok) throw new StripeError(res.status, body.error?.message ?? `Stripe request failed (${res.status})`);
    return body;
  }
}

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, any> };
}

/**
 * Verify a webhook against the Stripe-Signature header. Rejects bad signatures
 * and timestamps outside the tolerance window (replay protection).
 */
export function verifyWebhook(payload: string, header: string | undefined, secret: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): StripeEvent {
  if (!header) throw new Error("Missing Stripe-Signature header");
  const pairs = header.split(",").map((p) => p.split("=", 2) as [string, string]);
  const t = Number(pairs.find(([k]) => k === "t")?.[1]);
  const signatures = pairs.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !signatures.length) throw new Error("Malformed Stripe-Signature header");
  if (Math.abs(nowSec - t) > toleranceSec) throw new Error("Webhook timestamp outside the tolerance window");
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest();
  const ok = signatures.some((s) => {
    const given = Buffer.from(s, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!ok) throw new Error("Webhook signature does not match");
  return JSON.parse(payload) as StripeEvent;
}

/** Build a valid signature header (tests and local tooling). */
export function signWebhook(payload: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest("hex")}`;
}
