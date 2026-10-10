import type { TownTaxSettings, TreasurySummary } from "../../shared/types.js";
import type { Config } from "../config.js";
import type { Store } from "../db/store.js";
import { PRICING_NOTE, isKnownModel } from "../llm/models.js";
import { costSplit } from "../llm/usage.js";
import { budgetStatus } from "./budget.js";
import { runsPerMonth } from "./scheduler.js";

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

/** Spend by who paid, what it was for, billing category, and the most expensive tasks. */
function breakdowns(store: Store): Pick<TreasurySummary, "funding" | "operations" | "categories" | "topTasks" | "retries"> {
  const funding = store.usageQuery<{ billing: string; cost: number; n: number; tokens: number }>(
    `SELECT billing, SUM(cost_usd) AS cost, COUNT(*) AS n, SUM(input_tokens + cache_read_tokens + cache_write_tokens + output_tokens) AS tokens
     FROM usage WHERE simulated = 0 GROUP BY billing ORDER BY cost DESC`,
  );
  const operations = store.usageQuery<{ op: string; cost: number; n: number; tokens: number }>(
    `SELECT CASE
              WHEN u.agent_id = 'hiring-desk' THEN 'hiring-desk'
              WHEN u.agent_id = 'system' THEN 'system'
              WHEN t.schedule_id IS NOT NULL OR t.created_by LIKE 'schedule:%' THEN 'scheduled'
              WHEN t.created_by IS NOT NULL AND t.created_by <> 'user' THEN 'delegated'
              ELSE 'work' END AS op,
            SUM(u.cost_usd) AS cost, COUNT(*) AS n, SUM(u.input_tokens + u.cache_read_tokens + u.cache_write_tokens + u.output_tokens) AS tokens
     FROM usage u LEFT JOIN tasks t ON t.id = u.task_id
     WHERE u.simulated = 0 GROUP BY op ORDER BY cost DESC`,
  );
  const perModel = store.usageQuery<{ model: string; fresh: number; cw: number; cr: number; out: number; think: number; s: number; f: number; cost: number }>(
    `SELECT model, SUM(input_tokens) AS fresh, SUM(cache_write_tokens) AS cw, SUM(cache_read_tokens) AS cr, SUM(output_tokens) AS out,
            COALESCE(SUM(thinking_tokens), 0) AS think, SUM(web_search_requests) AS s, SUM(web_fetch_requests) AS f, SUM(cost_usd) AS cost
     FROM usage WHERE simulated = 0 GROUP BY model`,
  );
  const costs = { freshInputUsd: 0, cacheWriteUsd: 0, cacheReadUsd: 0, outputUsd: 0, webSearchUsd: 0, otherUsd: 0 };
  const sums = { freshInput: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0, webSearches: 0, webFetches: 0 };
  for (const r of perModel) {
    const u = { inputTokens: Number(r.fresh), cacheWriteTokens: Number(r.cw), cacheReadTokens: Number(r.cr), outputTokens: Number(r.out), webSearchRequests: Number(r.s) };
    sums.freshInput += u.inputTokens;
    sums.cacheWrite += u.cacheWriteTokens;
    sums.cacheRead += u.cacheReadTokens;
    sums.output += u.outputTokens;
    sums.thinking += Number(r.think);
    sums.webSearches += u.webSearchRequests;
    sums.webFetches += Number(r.f);
    if (isKnownModel(r.model)) {
      const c = costSplit(r.model, u);
      costs.freshInputUsd += c.freshInputUsd;
      costs.cacheWriteUsd += c.cacheWriteUsd;
      costs.cacheReadUsd += c.cacheReadUsd;
      costs.outputUsd += c.outputUsd;
      costs.webSearchUsd += c.webSearchUsd;
    } else costs.otherUsd += Number(r.cost);
  }
  const topTasks = store.usageQuery<{ task_id: string; title: string; agent_id: string; cost: number; n: number; s: number; attempts: number }>(
    `SELECT u.task_id, t.title, u.agent_id, SUM(u.cost_usd) AS cost, COUNT(*) AS n, SUM(u.web_search_requests) AS s, t.attempts
     FROM usage u JOIN tasks t ON t.id = u.task_id
     WHERE u.simulated = 0 GROUP BY u.task_id ORDER BY cost DESC LIMIT 8`,
  );
  const retries = store.usageQuery<{ n: number; extra: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(attempts - 1), 0) AS extra FROM tasks WHERE attempts > 1`,
  )[0];
  return {
    funding: funding.map((r) => ({ billing: r.billing === "own" ? "own" : "platform", costUsd: Number(r.cost), requests: Number(r.n), tokens: Number(r.tokens) })),
    operations: operations.map((r) => ({ id: r.op as NonNullable<TreasurySummary["operations"]>[number]["id"], costUsd: Number(r.cost), requests: Number(r.n), tokens: Number(r.tokens) })),
    categories: { ...sums, costs },
    topTasks: topTasks.map((r) => ({ taskId: r.task_id, title: r.title, agentId: r.agent_id, costUsd: Number(r.cost), requests: Number(r.n), searches: Number(r.s), attempts: Number(r.attempts) })),
    retries: { tasks: Number(retries?.n ?? 0), extraAttempts: Number(retries?.extra ?? 0) },
  };
}

export function treasurySummary(store: Store, config: Config, simulated = false, rateLimit: TreasurySummary["rateLimit"] = null): TreasurySummary {
  // Simulated rows carry zero tokens and zero cost; exclude them so totals reflect real API usage only.
  const totals = store.usageQuery<Agg & { searches: number; fetches: number; code: number; live: number }>(
    `SELECT COALESCE(SUM(input_tokens + cache_read_tokens + cache_write_tokens),0) AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens, COALESCE(SUM(cost_usd),0) AS cost,
            COUNT(*) AS requests, COALESCE(SUM(web_search_requests),0) AS searches,
            COALESCE(SUM(web_fetch_requests),0) AS fetches, COALESCE(SUM(code_executions),0) AS code,
            COALESCE(SUM(CASE WHEN request_id IS NOT NULL THEN 1 ELSE 0 END),0) AS live
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
  const budget = budgetStatus(store, config, simulated);
  const tax = computeTownTax(settings, Number(week.cost), Number(week.tokens));

  return {
    totals: {
      inputTokens: Number(totals.input_tokens),
      outputTokens: Number(totals.output_tokens),
      costUsd: Number(totals.cost),
      requests: Number(totals.requests),
      webSearches: Number(totals.searches),
      webFetches: Number(totals.fetches),
      codeExecutions: Number(totals.code),
      liveRequests: Number(totals.live),
    },
    today: { costUsd: store.spendSince(today.toISOString()), budgetUsd: budget.effective.dailyUsd },
    budget,
    scheduleProjections: store
      .listSchedules()
      .filter((sch) => sch.enabled)
      .map((sch) => {
        const costs = store.scheduleRunCosts(sch.id);
        const avg = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
        const runs = runsPerMonth(sch.cadence);
        return { scheduleId: sch.id, name: sch.name, runsPerMonth: runs, avgRunCostUsd: avg, projectedMonthlyUsd: avg === null ? null : avg * runs };
      }),
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
    ...breakdowns(store),
    rateLimit,
    costBasis: "estimated",
  };
}
