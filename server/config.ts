import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

/** Server configuration, read once from the environment. Secrets never leave the server. */
export interface Config {
  host: string;
  port: number;
  isProduction: boolean;
  dbPath: string;
  anthropicApiKey: string | null;
  defaultModel: string;
  refusalFallback: "default" | "off";
  adminToken: string | null;
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  maxTaskCostUsd: number;
  minScheduleIntervalMinutes: number;
  /** "all" = API + worker in one process; "api" = HTTP only; "worker" = queue + scheduler only. */
  role: "all" | "api" | "worker";
  maxTurnsPerTask: number;
  maxOutputTokens: number;
  maxDelegationDepth: number;
  workerConcurrency: number;
  workerPollMs: number;
  simulation: boolean;
  /** "local" = one town, admin token; "saas" = accounts, one private town per user. */
  mode: "local" | "saas";
  /** SaaS: directory holding accounts.sqlite and towns/<id>.sqlite. */
  dataDir: string;
  /** SaaS: take the client IP from the last X-Forwarded-For hop (behind Railway or another proxy). */
  trustProxy: boolean;
  /** SaaS: public origin (https://app.example.com); used for CSRF origin checks and secure cookies. */
  publicOrigin: string | null;
  /** SaaS: tasks running at once across all towns. */
  globalConcurrency: number;
  sessionDays: number;
  /** SaaS: operator ceiling on model spend across ALL users per UTC day (0 = none). */
  globalDailyBudgetUsd: number;
  /** Models villagers may use (null = any). Set per town from the owner's plan in SaaS mode. */
  allowedModels: string[] | null;
  /** SaaS: hours between automatic backups of every town and the accounts database (0 = off). */
  backupIntervalHours: number;
  backupKeep: number;
  /** SaaS billing. Enabled only when the key, webhook secret and both price ids are set. */
  stripe: { secretKey: string; webhookSecret: string; prices: { starter: string; pro: string } } | null;
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid numeric config value: ${value}`);
  return n;
}

/** Railway injects these into every deployment; on Railway the app defaults to SaaS mode. */
export function onRailway(env: NodeJS.ProcessEnv): boolean {
  return !!(env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_SERVICE_ID || env.RAILWAY_ENVIRONMENT_NAME);
}

function parseMode(v: string | undefined, fallback: Config["mode"]): Config["mode"] {
  const m = v?.trim() || fallback;
  if (m !== "local" && m !== "saas") throw new Error(`AGENTOPIA_MODE must be local or saas (got "${m}")`);
  return m;
}

function parseRole(v: string | undefined): Config["role"] {
  const r = v?.trim() || "all";
  if (r !== "all" && r !== "api" && r !== "worker") throw new Error(`AGENTOPIA_ROLE must be all, api or worker (got "${r}")`);
  return r;
}

/** Read NAME, or the file at NAME_FILE (Docker/Kubernetes secrets). */
function readSecret(env: NodeJS.ProcessEnv, name: string): string | null {
  const direct = env[name]?.trim();
  if (direct) return direct;
  const file = env[`${name}_FILE`]?.trim();
  if (!file) return null;
  try {
    return fs.readFileSync(file, "utf8").trim() || null;
  } catch (err) {
    throw new Error(`Could not read ${name}_FILE (${file}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const railway = onRailway(env);
  // Railway gives the service a public domain once one is generated; use it unless an origin is set explicitly.
  const railwayOrigin = railway && env.RAILWAY_PUBLIC_DOMAIN?.trim() ? `https://${env.RAILWAY_PUBLIC_DOMAIN.trim()}` : null;
  const host = env.HOST?.trim() || "127.0.0.1";
  const adminToken = readSecret(env, "AGENTOPIA_ADMIN_TOKEN");
  const config: Config = {
    host,
    port: num(env.PORT, 8787),
    isProduction: env.NODE_ENV === "production",
    dbPath: path.resolve(env.AGENTOPIA_DB_PATH?.trim() || "./data/agentopia.sqlite"),
    anthropicApiKey: readSecret(env, "ANTHROPIC_API_KEY"),
    defaultModel: env.AGENTOPIA_DEFAULT_MODEL?.trim() || "claude-opus-5-5",
    refusalFallback: env.AGENTOPIA_REFUSAL_FALLBACK?.trim() === "off" ? "off" : "default",
    adminToken,
    dailyBudgetUsd: num(env.AGENTOPIA_DAILY_BUDGET_USD, 5),
    monthlyBudgetUsd: num(env.AGENTOPIA_MONTHLY_BUDGET_USD, 50),
    maxTaskCostUsd: num(env.AGENTOPIA_MAX_TASK_COST_USD, 1),
    minScheduleIntervalMinutes: Math.max(1, num(env.AGENTOPIA_MIN_SCHEDULE_INTERVAL_MINUTES, 15)),
    role: parseRole(env.AGENTOPIA_ROLE),
    maxTurnsPerTask: Math.max(1, num(env.AGENTOPIA_MAX_TURNS_PER_TASK, 8)),
    maxOutputTokens: Math.max(1024, num(env.AGENTOPIA_MAX_OUTPUT_TOKENS, 16000)),
    maxDelegationDepth: num(env.AGENTOPIA_MAX_DELEGATION_DEPTH, 3),
    workerConcurrency: Math.max(1, num(env.AGENTOPIA_WORKER_CONCURRENCY, 2)),
    workerPollMs: Math.max(200, num(env.AGENTOPIA_WORKER_POLL_MS, 1500)),
    simulation: env.AGENTOPIA_SIMULATION?.trim() === "true",
    mode: parseMode(env.AGENTOPIA_MODE, railway ? "saas" : "local"),
    dataDir: path.resolve(env.AGENTOPIA_DATA_DIR?.trim() || (railway ? "/data" : "./data")),
    trustProxy: (env.AGENTOPIA_TRUST_PROXY?.trim() || (railway ? "true" : "false")) === "true",
    publicOrigin: env.AGENTOPIA_PUBLIC_ORIGIN?.trim().replace(/\/$/, "") || railwayOrigin,
    globalConcurrency: Math.max(1, num(env.AGENTOPIA_GLOBAL_CONCURRENCY, 8)),
    sessionDays: Math.max(1, num(env.AGENTOPIA_SESSION_DAYS, 30)),
    globalDailyBudgetUsd: num(env.AGENTOPIA_GLOBAL_DAILY_BUDGET_USD, 0),
    allowedModels: null,
    backupIntervalHours: num(env.AGENTOPIA_BACKUP_INTERVAL_HOURS, env.NODE_ENV === "production" ? 24 : 0),
    backupKeep: Math.max(1, num(env.AGENTOPIA_BACKUP_KEEP, 7)),
    stripe: null,
  };
  const stripeKey = readSecret(env, "STRIPE_SECRET_KEY");
  const stripeWebhook = readSecret(env, "STRIPE_WEBHOOK_SECRET");
  const priceStarter = env.STRIPE_PRICE_STARTER?.trim();
  const pricePro = env.STRIPE_PRICE_PRO?.trim();
  const stripeParts = [stripeKey, stripeWebhook, priceStarter, pricePro];
  if (stripeParts.every(Boolean)) {
    config.stripe = { secretKey: stripeKey!, webhookSecret: stripeWebhook!, prices: { starter: priceStarter!, pro: pricePro! } };
  } else if (stripeParts.some(Boolean)) {
    throw new Error("Stripe billing needs all of STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_STARTER and STRIPE_PRICE_PRO (or none of them).");
  }
  if (config.mode === "saas" && config.stripe && config.isProduction && !config.publicOrigin) {
    throw new Error("Set AGENTOPIA_PUBLIC_ORIGIN (e.g. https://app.example.com) so Stripe can redirect back after checkout.");
  }
  if (config.mode === "saas") {
    if (config.role !== "all") throw new Error("AGENTOPIA_MODE=saas runs the API and worker in one process; leave AGENTOPIA_ROLE unset (all).");
    if (config.simulation && config.isProduction) throw new Error("AGENTOPIA_SIMULATION cannot be used with AGENTOPIA_MODE=saas in production.");
    if (config.publicOrigin && !/^https?:\/\/[^/]+$/.test(config.publicOrigin)) throw new Error("AGENTOPIA_PUBLIC_ORIGIN must look like https://app.example.com");
  }
  assertSafeBinding(config);
  return config;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/** Refuse to expose the control API beyond loopback without authentication. */
export function assertSafeBinding(config: Pick<Config, "host" | "adminToken"> & { mode?: Config["mode"] }): void {
  // SaaS mode authenticates every request with a user session.
  if (config.mode === "saas") return;
  if (!LOOPBACK.has(config.host) && !config.adminToken) {
    throw new Error(
      `Refusing to bind to ${config.host} without AGENTOPIA_ADMIN_TOKEN. ` +
        "Set a long random token or bind to 127.0.0.1.",
    );
  }
}
