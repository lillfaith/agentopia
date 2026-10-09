import fs from "node:fs";
import path from "node:path";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import type { Config } from "../config.js";
import { log } from "../log.js";
import { createProvider, UnconfiguredProvider } from "../app.js";
import { VERSION } from "../api/routes.js";
import { body } from "../api/security.js";
import type { LLMProvider } from "../llm/provider.js";
import { AccountsStore, type Account } from "./accounts.js";
import { registerBilling, registerStripeWebhook } from "./billing.js";
import { backupSaas } from "./backup.js";
import { dummyHash, hashPassword, verifyPassword } from "./passwords.js";
import { RateLimiter } from "./rateLimit.js";
import { Towns, type TownsOptions } from "./towns.js";

type Env = { Variables: { account: Account; townId: string; sessionToken: string } };

export interface SaasOptions extends TownsOptions {
  provider?: LLMProvider;
  /** Stand-in for fetch against api.stripe.com (tests). */
  stripeFetch?: typeof fetch;
  /** Start the background worker loop (tests drive it by hand). */
  startWorker?: boolean;
}

const credentials = z
  .object({
    email: z.string().trim().toLowerCase().max(254).email("Enter a valid email address"),
    password: z.string().min(10, "Use at least 10 characters").max(200),
  })
  .strict();

/** Town API paths a SaaS user may not reach (operator-only). */
const OPERATOR_ONLY = new Set(["/api/system/test-connection"]);

/**
 * Multi-user server: accounts and sessions in front of one private town per user.
 * Authorization is structural: after authentication, a request is handed to the
 * caller's own town (its own database file), so no route can address another
 * user's data.
 */
export function createSaasApp(config: Config, opts: SaasOptions = {}) {
  fs.mkdirSync(path.join(config.dataDir, "towns"), { recursive: true });
  const accounts = AccountsStore.open(path.join(config.dataDir, "accounts.sqlite"));
  const provider = opts.provider ?? createProvider(config) ?? new UnconfiguredProvider();
  const towns = new Towns(config, accounts, provider, { runWorkers: opts.startWorker !== false, ...opts });

  const secure = config.isProduction || !!config.publicOrigin?.startsWith("https://");
  const COOKIE = secure ? "__Host-agentopia_session" : "agentopia_session";
  const sessionMs = config.sessionDays * 86_400_000;
  const allowedOriginHost = config.publicOrigin ? new URL(config.publicOrigin).host : null;

  const loginByIp = new RateLimiter(30, 15 * 60_000);
  const failuresByEmail = new RateLimiter(8, 15 * 60_000);
  const signupByIp = new RateLimiter(5, 60 * 60_000);
  const apiByUser = new RateLimiter(600, 60_000);

  const clientIp = (c: Context): string => {
    if (config.trustProxy) {
      const xff = c.req.header("x-forwarded-for");
      if (xff) return xff.split(",").at(-1)!.trim();
    }
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      return "unknown";
    }
  };

  const setSessionCookie = (c: Context, token: string) =>
    setCookie(c, COOKIE, token, { httpOnly: true, secure, sameSite: "Lax", path: "/", maxAge: Math.floor(sessionMs / 1000) });

  const startSession = (c: Context, account: Account) => {
    const { token } = accounts.createSession(account.id, sessionMs, { ip: clientIp(c), userAgent: c.req.header("user-agent") ?? null });
    setSessionCookie(c, token);
  };

  const me = (account: Account) => {
    const ent = towns.entitlements(account.id, true);
    return {
      user: { id: account.id, email: account.email, createdAt: account.createdAt },
      plan: {
        id: ent.plan.id,
        label: ent.plan.label,
        canRun: ent.canRun,
        reason: ent.reason,
        warning: ent.warning,
        trialEndsAt: ent.trialEndsAt,
        limits: { dailyUsd: ent.plan.dailyUsd, monthlyUsd: ent.plan.monthlyUsd, perTaskUsd: ent.plan.perTaskUsd, concurrency: ent.plan.concurrency, models: ent.plan.models },
      },
    };
  };

  /** CSRF: mutations must be JSON from our own origin (SameSite=Lax cookies are the first line). */
  const csrf: MiddlewareHandler = async (c, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
    if (!(c.req.header("content-type") ?? "").includes("application/json")) return c.json({ error: "Expected application/json" }, 415);
    if (c.req.header("sec-fetch-site") === "cross-site") return c.json({ error: "Cross-origin request rejected" }, 403);
    const origin = c.req.header("origin");
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        /* invalid */
      }
      if (originHost !== c.req.header("host") && originHost !== allowedOriginHost) return c.json({ error: "Cross-origin request rejected" }, 403);
    }
    return next();
  };

  const requireSession: MiddlewareHandler<Env> = async (c, next) => {
    const token = getCookie(c, COOKIE);
    const session = token ? accounts.resolveSession(token, sessionMs) : null;
    if (!token || !session) {
      if (token) deleteCookie(c, COOKIE, { path: "/", secure });
      return c.json({ error: "Sign in required", auth: "session" }, 401);
    }
    const limited = apiByUser.hit(session.account.id);
    if (!limited.ok) {
      c.header("retry-after", String(limited.retryAfterSec));
      return c.json({ error: "Too many requests — slow down a little." }, 429);
    }
    if (session.renewed) setSessionCookie(c, token);
    const townId = accounts.townOf(session.account.id);
    if (!townId) return c.json({ error: "No town for this account" }, 500);
    c.set("account", session.account);
    c.set("townId", townId);
    c.set("sessionToken", token);
    return next();
  };

  const app = new Hono<Env>();
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Nunito comes from Google Fonts (the town's typeface).
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
      strictTransportSecurity: secure ? "max-age=31536000; includeSubDomains" : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use("/api/*", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: "Request body too large" }, 413) }));

  app.get("/api/health", (c) => c.json({ ok: true, version: VERSION }));
  app.get("/api/ready", (c) => {
    try {
      accounts.db.prepare("SELECT 1").get();
    } catch {
      return c.json({ ready: false, reason: "accounts database unavailable" }, 503);
    }
    if (opts.startWorker !== false && !towns.running) return c.json({ ready: false, reason: "worker not running" }, 503);
    return c.json({ ready: true, openTowns: towns.openCount, activeTasks: towns.activeTasks });
  });

  const billingDeps = { config, accounts, towns, stripeFetch: opts.stripeFetch, clientIp };
  registerStripeWebhook(app, billingDeps);

  app.use("/api/*", csrf);

  // ── auth ──
  app.post("/api/auth/signup", async (c) => {
    const ip = clientIp(c);
    const limited = signupByIp.hit(ip);
    if (!limited.ok) return c.json({ error: `Too many sign-ups from this network. Try again in ${Math.ceil(limited.retryAfterSec / 60)} min.` }, 429);
    const b = await body(c, credentials);
    if (!b.ok) return b.res;
    const created = accounts.createUser(b.data.email, await hashPassword(b.data.password));
    if (!created) return c.json({ error: "An account with this email already exists. Sign in instead." }, 409);
    accounts.audit(created.account.id, "account.signup", ip);
    towns.get(created.townId); // build the new town now so the first visit is instant
    startSession(c, created.account);
    return c.json(me(created.account), 201);
  });

  app.post("/api/auth/login", async (c) => {
    const ip = clientIp(c);
    const limited = loginByIp.hit(ip);
    if (!limited.ok) return c.json({ error: `Too many sign-in attempts. Try again in ${Math.ceil(limited.retryAfterSec / 60)} min.` }, 429);
    const b = await body(c, credentials.extend({ password: z.string().min(1).max(200) }));
    if (!b.ok) return b.res;
    const { email, password } = b.data;
    const locked = failuresByEmail.blocked(email);
    if (locked.blocked) return c.json({ error: `Too many failed attempts for this account. Try again in ${Math.ceil(locked.retryAfterSec / 60)} min.` }, 429);
    const found = accounts.findByEmail(email);
    const ok = await verifyPassword(password, found?.passwordHash ?? (await dummyHash()));
    if (!found || !ok || found.account.status !== "active") {
      failuresByEmail.hit(email);
      accounts.audit(found?.account.id ?? null, "account.login_failed", ip, found ? {} : { email });
      return c.json({ error: "Email or password is incorrect." }, 401);
    }
    failuresByEmail.reset(email);
    accounts.audit(found.account.id, "account.login", ip);
    startSession(c, found.account);
    return c.json(me(found.account));
  });

  app.post("/api/auth/logout", (c) => {
    const token = getCookie(c, COOKIE);
    if (token) {
      const s = accounts.resolveSession(token, sessionMs);
      accounts.deleteSession(token);
      if (s) accounts.audit(s.account.id, "account.logout", clientIp(c));
    }
    deleteCookie(c, COOKIE, { path: "/", secure });
    return c.json({ ok: true });
  });

  app.use("/api/*", requireSession);

  app.get("/api/auth/me", (c) => c.json(me(c.get("account"))));
  app.get("/api/account/audit", (c) => c.json(accounts.auditFor(c.get("account").id, 100)));
  registerBilling(app, billingDeps);

  // ── everything else: the caller's own town ──
  app.all("/api/*", async (c) => {
    if (OPERATOR_ONLY.has(c.req.path)) return c.json({ error: "Not found" }, 404);
    const townId = c.get("townId");
    const town = towns.get(townId);
    const res = await town.app.api.fetch(c.req.raw);
    if (c.req.method !== "GET") {
      // Every change to a town is attributable: who, what, when, from where (never request bodies).
      accounts.audit(c.get("account").id, "town.change", clientIp(c), { method: c.req.method, path: c.req.path, status: res.status });
      if (res.status < 400) towns.wake(townId);
    }
    return res;
  });

  app.onError((e, c) => {
    log.error("Unhandled API error", e, { scope: "saas", path: c.req.path });
    return c.json({ error: "Internal server error" }, 500);
  });

  if (opts.startWorker !== false) towns.start();
  const pruner = setInterval(() => accounts.pruneSessions(), 60 * 60_000);
  pruner.unref();
  const backups = config.backupIntervalHours > 0 && opts.startWorker !== false
    ? setInterval(() => {
        try {
          const b = backupSaas(config.dataDir, config.backupKeep);
          log.info("Backup written", { scope: "backup", dir: b.dir, files: b.files, bytes: b.bytes });
        } catch (err) {
          log.error("Backup failed", err, { scope: "backup" });
        }
      }, config.backupIntervalHours * 3_600_000)
    : null;
  backups?.unref();

  let stopped = false;
  return {
    app,
    accounts,
    towns,
    provider,
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(pruner);
      if (backups) clearInterval(backups);
      await towns.stop();
      accounts.db.close();
    },
  };
}
