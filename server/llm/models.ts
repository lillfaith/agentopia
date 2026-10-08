import type { ModelInfo } from "../../shared/types.js";

/**
 * Known models and list prices (USD per million tokens, Anthropic first-party API).
 * Prices are ESTIMATES used for the treasury; always reconcile against your invoice.
 * Update this table when pricing changes — it is the only place prices live.
 */
export interface ModelSpec extends ModelInfo {
  cacheReadPerMTok: number;
  /** 5-minute cache writes are billed at 1.25x input. */
  cacheWritePerMTok: number;
  /** Whether the server-side `fallbacks: "default"` refusal fallback may be sent. */
  supportsServerFallback: boolean;
  /** Whether the web_search_20260209 server tool variant is supported. */
  supportsWebSearch: boolean;
}

export const WEB_SEARCH_USD_PER_REQUEST = 10 / 1000;

export const MODELS: ModelSpec[] = [
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 5,
    supportsServerFallback: true,
    supportsWebSearch: true,
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 2.5,
    supportsServerFallback: true,
    supportsWebSearch: true,
  },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadPerMTok: 0.01,
    cacheWritePerMTok: 0.125,
    supportsServerFallback: false,
    supportsWebSearch: false,
  },
  {
    id: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    inputPerMTok: 10,
    outputPerMTok: 50,
    cacheReadPerMTok: 0.25,
    cacheWritePerMTok: 12.5,
    supportsServerFallback: true,
    supportsWebSearch: false,
  },
];

const FALLBACK_SPEC: ModelSpec = {
  id: "unknown",
  label: "Unknown model",
  // Price unknown models conservatively at the most expensive tier so the budget cap still bites.
  inputPerMTok: 10,
  outputPerMTok: 50,
  cacheReadPerMTok: 1,
  cacheWritePerMTok: 12.5,
  supportsServerFallback: false,
  supportsWebSearch: false,
};

export function modelSpec(id: string): ModelSpec {
  return MODELS.find((m) => m.id === id) ?? { ...FALLBACK_SPEC, id, label: id };
}

export function isKnownModel(id: string): boolean {
  return MODELS.some((m) => m.id === id);
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearchRequests: number;
  /** Web fetch has no per-request fee (tokens only); counted for visibility. */
  webFetchRequests?: number;
  /** Hosted code-execution tool uses; sandbox time is billed by Anthropic per container-hour and not estimated here. */
  codeExecutions?: number;
}

export function estimateCostUsd(modelId: string, u: TokenUsage): number {
  const p = modelSpec(modelId);
  // Haiku 5.5 list price rises above 100K-token prompts; approximate with the higher tier.
  const longPrompt = modelId === "claude-haiku-5-5" && u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens > 100_000;
  const inRate = longPrompt ? 0.5 : p.inputPerMTok;
  const outRate = longPrompt ? 2.5 : p.outputPerMTok;
  const cost =
    (u.inputTokens * inRate +
      u.outputTokens * outRate +
      u.cacheReadTokens * p.cacheReadPerMTok +
      u.cacheWriteTokens * p.cacheWritePerMTok) /
      1_000_000 +
    u.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export const PRICING_NOTE =
  "Costs are estimates from list prices in server/llm/models.ts (incl. $10 per 1,000 web searches; web fetch has no extra fee). " +
  "Code-execution sandbox time ($0.05/container-hour after 1,550 free hours/month, free alongside web tools) is not estimated. " +
  "Reconcile against your Anthropic invoice; batch discounts, regional pricing and fallback re-pricing are not modelled.";
