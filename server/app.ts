import type { Config } from "./config.js";
import { openDatabase } from "./db/database.js";
import { Store } from "./db/store.js";
import { seedTown } from "./agents/seed.js";
import { AnthropicProvider } from "./llm/anthropic.js";
import type { LLMProvider } from "./llm/provider.js";
import { SimulatedProvider } from "./llm/simulated.js";
import { TaskRunner } from "./engine/runner.js";
import { createApi } from "./api/routes.js";

/** Pick the provider. Simulation is only ever used when explicitly enabled AND no key is set. */
export function createProvider(config: Config): LLMProvider | null {
  if (config.anthropicApiKey) return new AnthropicProvider(config.anthropicApiKey, config.refusalFallback);
  if (config.simulation) return new SimulatedProvider();
  return null;
}

/** Provider used when no key is configured: every task fails fast with a clear message. */
export class UnconfiguredProvider implements LLMProvider {
  readonly id = "anthropic";
  readonly simulated = false;
  userMessage(text: string) {
    return { role: "user", content: text };
  }
  toolResultsMessage() {
    return { role: "user", content: [] };
  }
  async generate(): Promise<never> {
    const { NonRetryableError } = await import("./llm/provider.js");
    throw new NonRetryableError("No ANTHROPIC_API_KEY configured on the server. Add it to .env and restart.");
  }
}

export interface AppOptions {
  provider?: LLMProvider;
  startWorker?: boolean;
  timings?: { retryBaseMs?: number; statusDecayMs?: number };
}

export function createApp(config: Config, opts: AppOptions = {}) {
  const db = openDatabase(config.dbPath);
  const store = new Store(db);
  seedTown(store, config.defaultModel);
  const provider = opts.provider ?? createProvider(config) ?? new UnconfiguredProvider();
  const runner = new TaskRunner(store, provider, config, opts.timings);
  const api = createApi({ config, store, runner });
  // API-only processes never run tasks or schedules; a separate worker process does.
  const startWorker = opts.startWorker ?? config.role !== "api";
  if (startWorker) runner.start();
  return { db, store, runner, api, provider };
}
