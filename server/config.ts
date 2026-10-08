import "dotenv/config";
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
  maxTurnsPerTask: number;
  maxOutputTokens: number;
  maxDelegationDepth: number;
  workerConcurrency: number;
  workerPollMs: number;
  simulation: boolean;
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid numeric config value: ${value}`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const host = env.HOST?.trim() || "127.0.0.1";
  const adminToken = env.AGENTOPIA_ADMIN_TOKEN?.trim() || null;
  const config: Config = {
    host,
    port: num(env.PORT, 8787),
    isProduction: env.NODE_ENV === "production",
    dbPath: path.resolve(env.AGENTOPIA_DB_PATH?.trim() || "./data/agentopia.sqlite"),
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    defaultModel: env.AGENTOPIA_DEFAULT_MODEL?.trim() || "claude-opus-5-5",
    refusalFallback: env.AGENTOPIA_REFUSAL_FALLBACK?.trim() === "off" ? "off" : "default",
    adminToken,
    dailyBudgetUsd: num(env.AGENTOPIA_DAILY_BUDGET_USD, 5),
    maxTurnsPerTask: Math.max(1, num(env.AGENTOPIA_MAX_TURNS_PER_TASK, 8)),
    maxOutputTokens: Math.max(1024, num(env.AGENTOPIA_MAX_OUTPUT_TOKENS, 16000)),
    maxDelegationDepth: num(env.AGENTOPIA_MAX_DELEGATION_DEPTH, 3),
    workerConcurrency: Math.max(1, num(env.AGENTOPIA_WORKER_CONCURRENCY, 2)),
    workerPollMs: Math.max(200, num(env.AGENTOPIA_WORKER_POLL_MS, 1500)),
    simulation: env.AGENTOPIA_SIMULATION?.trim() === "true",
  };
  assertSafeBinding(config);
  return config;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/** Refuse to expose the control API beyond loopback without authentication. */
export function assertSafeBinding(config: Pick<Config, "host" | "adminToken">): void {
  if (!LOOPBACK.has(config.host) && !config.adminToken) {
    throw new Error(
      `Refusing to bind to ${config.host} without AGENTOPIA_ADMIN_TOKEN. ` +
        "Set a long random token or bind to 127.0.0.1.",
    );
  }
}
