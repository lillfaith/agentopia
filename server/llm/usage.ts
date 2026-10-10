import type { TaskUsageBreakdown, TaskUsageCall, UsageCostSplit, UsageRecord } from "../../shared/types.js";
import { WEB_SEARCH_USD_PER_REQUEST, estimateCostUsd, modelSpec } from "./models.js";

/**
 * Splits a call's estimated cost into its charges, using the same price table and
 * rules as estimateCostUsd (which the treasury records). Reporting only: it never
 * changes what is recorded or billed.
 *
 * Token categories are disjoint in the API's usage object: `input_tokens` is the
 * uncached input only, and cache reads and writes are reported separately, so each
 * category is charged exactly once.
 */
export function costSplit(
  modelId: string,
  u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; webSearchRequests: number },
): UsageCostSplit {
  const p = modelSpec(modelId);
  const longPrompt = modelId === "claude-haiku-5-5" && u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens > 100_000;
  const inRate = longPrompt ? 0.5 : p.inputPerMTok;
  const outRate = longPrompt ? 2.5 : p.outputPerMTok;
  const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
  const split = {
    freshInputUsd: round((u.inputTokens * inRate) / 1_000_000),
    cacheReadUsd: round((u.cacheReadTokens * p.cacheReadPerMTok) / 1_000_000),
    cacheWriteUsd: round((u.cacheWriteTokens * p.cacheWritePerMTok) / 1_000_000),
    outputUsd: round((u.outputTokens * outRate) / 1_000_000),
    webSearchUsd: round(u.webSearchRequests * WEB_SEARCH_USD_PER_REQUEST),
  };
  return { ...split, totalUsd: estimateCostUsd(modelId, u) };
}

const ZERO_SPLIT: UsageCostSplit = { freshInputUsd: 0, cacheReadUsd: 0, cacheWriteUsd: 0, outputUsd: 0, webSearchUsd: 0, totalUsd: 0 };

/** Every recorded call of a task with its cost split, plus totals and plain-language notes. */
export function taskUsageBreakdown(taskId: string, depth: TaskUsageBreakdown["depth"], rows: UsageRecord[], attempts = 1): TaskUsageBreakdown {
  const calls: TaskUsageCall[] = rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    model: r.model,
    requestedModel: r.requestedModel,
    requestId: r.requestId,
    simulated: r.simulated,
    billing: r.billing ?? "platform",
    freshInputTokens: r.inputTokens,
    cacheReadTokens: r.cacheReadTokens,
    cacheWriteTokens: r.cacheWriteTokens,
    outputTokens: r.outputTokens,
    thinkingTokens: r.thinkingTokens ?? null,
    serverIterations: r.serverIterations ?? null,
    contextTokens: r.contextTokens ?? null,
    webSearches: r.webSearchRequests,
    webFetches: r.webFetchRequests,
    costUsd: r.costUsd,
    cost: r.simulated ? ZERO_SPLIT : costSplit(r.model, r),
  }));
  const sum = (f: (c: TaskUsageCall) => number) => calls.reduce((s, c) => s + f(c), 0);
  const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
  const totals = {
    apiCalls: calls.length,
    serverIterations: sum((c) => c.serverIterations ?? 1),
    freshInputTokens: sum((c) => c.freshInputTokens),
    cacheReadTokens: sum((c) => c.cacheReadTokens),
    cacheWriteTokens: sum((c) => c.cacheWriteTokens),
    outputTokens: sum((c) => c.outputTokens),
    thinkingTokens: sum((c) => c.thinkingTokens ?? 0),
    allTokens: sum((c) => c.freshInputTokens + c.cacheReadTokens + c.cacheWriteTokens + c.outputTokens),
    webSearches: sum((c) => c.webSearches),
    webFetches: sum((c) => c.webFetches),
    peakContextTokens: calls.reduce((m, c) => Math.max(m, c.contextTokens ?? 0), 0),
  };
  const cost = {
    freshInputUsd: round(sum((c) => c.cost.freshInputUsd)),
    cacheReadUsd: round(sum((c) => c.cost.cacheReadUsd)),
    cacheWriteUsd: round(sum((c) => c.cost.cacheWriteUsd)),
    outputUsd: round(sum((c) => c.cost.outputUsd)),
    webSearchUsd: round(sum((c) => c.cost.webSearchUsd)),
    totalUsd: round(sum((c) => c.cost.totalUsd)),
    recordedUsd: round(sum((c) => (c.simulated ? 0 : c.costUsd))),
  };
  const allInput = totals.freshInputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  const notes: string[] = [];
  if (totals.cacheReadTokens > 0) {
    notes.push(
      `${totals.cacheReadTokens.toLocaleString("en-US")} of the ${totals.allTokens.toLocaleString("en-US")} tokens were re-read from the prompt cache, billed at about a tenth of the input price.`,
    );
  }
  if (totals.serverIterations > totals.apiCalls) {
    notes.push(`Web research ran inside the API calls: ${totals.serverIterations} model steps in ${totals.apiCalls} call${totals.apiCalls === 1 ? "" : "s"}, each re-reading the conversation so far.`);
  }
  if (cost.webSearchUsd > 0) notes.push(`Web searches cost $10 per 1,000 ($0.01 each). Page reads have no fee beyond their tokens.`);
  if (attempts > 1) {
    notes.push(`This task needed ${attempts} attempts. A retry continues from the saved conversation; a request that failed with an error isn't billed.`);
  }
  if (calls.some((c) => c.billing === "own")) notes.push("Calls marked “own key” are billed by that provider, not your Agentopia plan.");
  if (calls.some((c) => !c.simulated)) notes.push("All costs are estimates from list prices. Each call's request id can be matched in the provider's console.");
  if (Math.abs(cost.totalUsd - cost.recordedUsd) > 0.000005) {
    notes.push(`Recorded spend ($${cost.recordedUsd.toFixed(4)}) differs from the recomputed estimate ($${cost.totalUsd.toFixed(4)}); prices may have changed since it was recorded.`);
  }
  return {
    taskId,
    depth,
    models: [...new Set(calls.map((c) => c.model))],
    calls,
    totals,
    cost,
    cacheHitRate: allInput ? totals.cacheReadTokens / allInput : 0,
    attempts,
    notes,
  };
}
