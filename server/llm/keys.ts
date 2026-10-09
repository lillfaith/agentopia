import Anthropic from "@anthropic-ai/sdk";
import { rankModels } from "../../shared/modelRank.js";
import type { Agent, CredentialService } from "../../shared/types.js";
import type { Config } from "../config.js";
import type { Store } from "../db/store.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider, listGeminiModels } from "./gemini.js";
import { OpenAIProvider, listOpenAIModels } from "./openai.js";
import type { LLMProvider } from "./provider.js";

export const SERVICE_LABEL: Record<CredentialService, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "OpenAI (GPT / Codex)",
  gemini: "Google Gemini",
  github: "GitHub",
};

export interface KeyCheck {
  ok: boolean;
  detail: string;
  models: string[];
}

/** Lets tests replace the network calls a key check makes. */
export interface KeyCheckers {
  anthropic(secret: string): Promise<string[]>;
  openai(secret: string): Promise<string[]>;
  gemini(secret: string): Promise<string[]>;
  github(secret: string): Promise<string>;
}

export const LIVE_CHECKERS: KeyCheckers = {
  async anthropic(secret) {
    const client = new Anthropic({ apiKey: secret, maxRetries: 1 });
    const ids: string[] = [];
    for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
    return ids.filter((id) => id.startsWith("claude-")).sort();
  },
  openai: (secret) => listOpenAIModels(secret),
  gemini: (secret) => listGeminiModels(secret),
  async github(secret) {
    const res = await fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${secret}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "agentopia" },
    });
    if (!res.ok) throw Object.assign(new Error(`GitHub answered ${res.status}`), { status: res.status });
    const user = (await res.json()) as { login?: string };
    return user.login ?? "unknown user";
  },
};

/**
 * Make one cheap, read-only call with the key (list models, or who the GitHub token belongs to),
 * so a mistyped or revoked key is caught when it's added, not halfway through a task.
 */
export async function checkKey(service: CredentialService, secret: string, checkers: KeyCheckers = LIVE_CHECKERS): Promise<KeyCheck> {
  try {
    if (service === "github") {
      const login = await checkers.github(secret);
      return { ok: true, detail: `Signed in as ${login}`, models: [] };
    }
    const models = rankModels(service, await checkers[service](secret));
    return { ok: true, detail: models.length ? `${models.length} models available` : "Key works", models };
  } catch (err) {
    const status = (err as { status?: number }).status;
    const why = status === 401 || status === 403 ? "the key was rejected" : err instanceof Error ? err.message.slice(0, 200) : String(err);
    return { ok: false, detail: `${SERVICE_LABEL[service]}: ${why}`, models: [] };
  }
}

export interface ResolvedProvider {
  provider: LLMProvider;
  /** "own" = the owner's own key pays (outside plan limits). */
  billing: "platform" | "own";
  /** Identifies the transcript format and key: a task's conversation only continues on the same one. */
  key: string;
}

type Factory = (service: "anthropic" | "openai" | "gemini", secret: string) => LLMProvider;

/**
 * Picks the provider for a villager: Agentopia's own Claude, or the owner's key for Claude,
 * OpenAI or Gemini. Providers built from owners' keys are cached per key.
 */
export class ProviderResolver {
  private readonly cache = new Map<string, LLMProvider>();

  constructor(
    private readonly platform: LLMProvider,
    private readonly store: Store,
    private readonly config: Config,
    private readonly factory: Factory = (service, secret) =>
      service === "openai"
        ? new OpenAIProvider(secret)
        : service === "gemini"
          ? new GeminiProvider(secret)
          : new AnthropicProvider(secret, config.refusalFallback, {}, { webToolMode: config.webToolMode }),
  ) {}

  resolve(agent: Pick<Agent, "provider" | "credentialId" | "name">): ResolvedProvider | { error: string } {
    if (!agent.credentialId) {
      if (agent.provider !== "anthropic") return { error: `${agent.name} uses ${SERVICE_LABEL[agent.provider]} but has no API key. Add one in Configure.` };
      return { provider: this.platform, billing: "platform", key: "platform" };
    }
    const cred = this.store.getCredential(agent.credentialId);
    if (!cred) return { error: `${agent.name}'s API key was removed. Pick another key in Configure.` };
    if (cred.service !== agent.provider) return { error: `${agent.name}'s key is for ${SERVICE_LABEL[cred.service]}, not ${SERVICE_LABEL[agent.provider]}.` };
    const cacheKey = `${cred.id}:${cred.service}`;
    let provider = this.cache.get(cacheKey);
    if (!provider) {
      const secret = this.store.credentialSecret(cred.id);
      if (!secret) return { error: "This server can't read stored keys (AGENTOPIA_SECRETS_KEY changed or missing)." };
      provider = this.factory(cred.service as "anthropic" | "openai" | "gemini", secret);
      this.cache.set(cacheKey, provider);
    }
    return { provider, billing: "own", key: `${cred.service}:${cred.id}` };
  }

  /** Forget a key's provider (after the key is deleted). */
  forget(credentialId: string): void {
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${credentialId}:`)) this.cache.delete(k);
  }
}
