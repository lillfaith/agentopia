import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import type { z } from "zod";
import type { Config } from "../config.js";

// ───────────────────────── security middleware ─────────────────────────

const LOOPBACK_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * - Bearer token when AGENTOPIA_ADMIN_TOKEN is set.
 * - Host header check on loopback deployments (DNS-rebinding protection).
 * - Mutations must be JSON with a same-origin (or absent) Origin (CSRF protection
 *   for the token-less local mode: browsers cannot send cross-site JSON without a
 *   CORS preflight, which this server never approves).
 */
export function security(config: Config): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path === "/api/health" || c.req.path === "/api/ready") return next();
    const host = c.req.header("host") ?? "";
    if (!config.adminToken && !LOOPBACK_HOSTS.test(host)) return c.json({ error: "Forbidden host" }, 403);
    if (config.adminToken) {
      const header = c.req.header("authorization") ?? "";
      const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
      const expected = Buffer.from(config.adminToken);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return c.json({ error: "Unauthorized" }, 401);
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      if (!(c.req.header("content-type") ?? "").includes("application/json")) return c.json({ error: "Expected application/json" }, 415);
      const origin = c.req.header("origin");
      if (origin) {
        let originHost = "";
        try {
          originHost = new URL(origin).host;
        } catch {
          /* invalid origin */
        }
        if (originHost !== host) return c.json({ error: "Cross-origin request rejected" }, 403);
      }
    }
    return next();
  };
}

export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, res: c.json({ error: "Invalid JSON body" }, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, res: c.json({ error: "Validation failed", issues: parsed.error.issues }, 400) };
  return { ok: true, data: parsed.data };
}

