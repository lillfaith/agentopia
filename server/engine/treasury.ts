import type { TownTaxSettings, TreasurySummary } from "../../shared/types.js";
import type { Store } from "../db/store.js";
import { PRICING_NOTE } from "../llm/models.js";

type Agg = { input_tokens: number; output_tokens: number; cost: number; requests: number };

/** Monday 00:00 UTC of the current week. */
export function weekStartUtc(d = new Date()): Date {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (start.getUTCDay() + 6) % 7; // Monday = 0
  start.setUTCDate(start.getUTCDate() - dow);
  return start;
}

/**
 * Voluntary "Town Tax" pledge suggestion. Pure calculation — Agentopia never
 * charges, donates or moves money.
 */
export function computeTownTax(settings: TownTaxSettings, weekCostUsd: number, weekTokens: number): { amount: number; capped: boolean } {
  if (!settings.enabled) return { amount: 0, capped: false };
  const raw = settings.mode === "percent_of_cost" ? (weekCostUsd * settings.rate) / 100 : (weekTokens / 1_000_000) * settings.rate;
  const cap = settings.weeklyCapUsd > 0 ? settings.weeklyCapUsd : Infinity;
  const amount = Math.min(raw, cap);
  return { amount: Math.round(amount * 100) / 100, capped: raw > cap };
}

export function treasurySummary(store: Store, dailyBudgetUsd: number): TreasurySummary {
  // Simulated rows carry zero tokens and zero cost; exclude them so totals reflect real API usage only.
  const totals = store.usageQuery<Agg & { searches: number }>(
    `SELECT COALESCE(SUM(input_tokens + cache_read_tokens + cache_write_tokens),0) AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens, COALESCE(SUM(cost_usd),0) AS cost,
            COUNT(*) AS requests, COALESCE(SUM(web_search_requests),0) AS searches
     FROM usage WHERE simulated = 0`,
  )[0];
  const byAgent = store.usageQuery<Agg & { agent_id: string }>(
    `SELECT agent_id, SUM(input_tokens + cache_read_tokens + cache_write_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
            SUM(cost_usd) AS cost, COUNT(*) AS requests
     FROM usage WHERE simulated = 0 GROUP BY agent_id ORDER BY cost DESC`,
  );
  const byModel = store.usageQuery<Agg & { model: string }>(
    `SELECT model, SUM(input_tokens + cache_read_tokens + cache_write_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
            SUM(cost_usd) AS cost, COUNT(*) AS requests
     FROM usage WHERE simulated = 0 GROUP BY model ORDER BY cost DESC`,
  );
  const since = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10);
  const daily = store.usageQuery<{ day: string; cost: number; tokens: number }>(
    `SELECT substr(ts, 1, 10) AS day, SUM(cost_usd) AS cost, SUM(input_tokens + cache_read_tokens + cache_write_tokens + output_tokens) AS tokens
     FROM usage WHERE simulated = 0 AND ts >= ? GROUP BY day ORDER BY day`,
    since,
  );

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const weekStart = weekStartUtc();
  const week = store.usageQuery<{ cost: number; tokens: number }>(
    `SELECT COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(input_tokens + cache_read_tokens + cache_write_tokens + output_tokens),0) AS tokens
     FROM usage WHERE simulated = 0 AND ts >= ?`,
    weekStart.toISOString(),
  )[0];
  const settings = store.getSettings().townTax;
  const tax = computeTownTax(settings, Number(week.cost), Number(week.tokens));

  return {
    totals: {
      inputTokens: Number(totals.input_tokens),
      outputTokens: Number(totals.output_tokens),
      costUsd: Number(totals.cost),
      requests: Number(totals.requests),
      webSearches: Number(totals.searches),
    },
    today: { costUsd: store.spendSince(today.toISOString()), budgetUsd: dailyBudgetUsd },
    byAgent: byAgent.map((r) => ({ agentId: r.agent_id, inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens), costUsd: Number(r.cost), requests: Number(r.requests) })),
    byModel: byModel.map((r) => ({ model: r.model, inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens), costUsd: Number(r.cost), requests: Number(r.requests) })),
    daily: daily.map((r) => ({ day: r.day, costUsd: Number(r.cost), tokens: Number(r.tokens) })),
    townTax: {
      settings,
      weekStart: weekStart.toISOString().slice(0, 10),
      weekCostUsd: Number(week.cost),
      weekTokens: Number(week.tokens),
      suggestedPledgeUsd: tax.amount,
      capped: tax.capped,
    },
    pricingNote: PRICING_NOTE,
  };
}
