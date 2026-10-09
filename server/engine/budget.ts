import type { Agent, BudgetLimits, BudgetStatus } from "../../shared/types.js";
import type { Config } from "../config.js";
import type { Store } from "../db/store.js";
import { WEB_SEARCH_USD_PER_REQUEST, modelSpec } from "../llm/models.js";
import type { HostedTool } from "../llm/provider.js";

/**
 * Budget enforcement.
 *
 * Hard ceilings come from the operator's environment; the owner can only set
 * LOWER limits in the UI. Before every model call the executor reserves a
 * worst-case cost for that call (full-price input incl. cache-write premium,
 * the whole max_tokens of output, and the maximum number of web searches) and
 * refuses the call if spend + reservation would cross any limit. Actual spend
 * therefore cannot exceed a limit by more than the estimation error of a single
 * call's input size.
 */

export function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
export function startOfUtcMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
export function nextUtcDay(d = new Date()): Date {
  return new Date(startOfUtcDay(d).getTime() + 86_400_000);
}
export function nextUtcMonth(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/** min of two limits where 0/null means "no limit". */
function tighter(hard: number, soft: number | null): number {
  if (soft === null || soft === undefined || soft <= 0) return hard;
  if (hard <= 0) return soft;
  return Math.min(hard, soft);
}

export function effectiveLimits(store: Store, config: Config): { hard: BudgetLimits; effective: BudgetLimits; soft: BudgetStatus["soft"] } {
  const soft = store.getSettings().budget;
  const hard = { dailyUsd: config.dailyBudgetUsd, monthlyUsd: config.monthlyBudgetUsd, perTaskUsd: config.maxTaskCostUsd };
  return {
    hard,
    soft,
    effective: {
      dailyUsd: tighter(hard.dailyUsd, soft.dailyUsd),
      monthlyUsd: tighter(hard.monthlyUsd, soft.monthlyUsd),
      perTaskUsd: tighter(hard.perTaskUsd, soft.perTaskUsd),
    },
  };
}

const over = (spent: number, limit: number) => limit > 0 && spent >= limit;

export function budgetStatus(store: Store, config: Config, simulated = false): BudgetStatus {
  const { hard, soft, effective } = effectiveLimits(store, config);
  const todayUsd = store.spendSince(startOfUtcDay().toISOString());
  const monthUsd = store.spendSince(startOfUtcMonth().toISOString());
  const byAgent = store.spendByAgentSince(startOfUtcDay().toISOString());
  const agentHolds = simulated
    ? []
    : store
        .listAgents()
        .filter((a) => a.dailyBudgetUsd !== null && a.dailyBudgetUsd > 0 && (byAgent.get(a.id) ?? 0) >= a.dailyBudgetUsd)
        .map((a) => a.id);
  return {
    hard,
    soft,
    effective,
    spent: { todayUsd, monthUsd },
    globalHold: !simulated && (over(todayUsd, effective.dailyUsd) || over(monthUsd, effective.monthlyUsd)),
    agentHolds,
    resetsAt: { day: nextUtcDay().toISOString(), month: nextUtcMonth().toISOString() },
  };
}

/** Conservative upper bound for one model call. */
export function worstCaseCallCost(input: { model: string; promptChars: number; maxTokens: number; hostedTools: HostedTool[]; maxSearches?: number }): number {
  const p = modelSpec(input.model);
  // ~3 chars/token is pessimistic for English+JSON; input priced at the cache-write premium.
  const inputTokens = Math.ceil(input.promptChars / 3);
  const inputRate = Math.max(p.inputPerMTok, p.cacheWritePerMTok);
  const searches = input.hostedTools.includes("web_search") ? (input.maxSearches ?? 5) * WEB_SEARCH_USD_PER_REQUEST : 0;
  return (inputTokens * inputRate + input.maxTokens * p.outputPerMTok) / 1_000_000 + searches;
}

export type PreflightResult =
  | { ok: true }
  | { ok: false; scope: "daily" | "monthly" | "agent"; message: string; resumeAt: string }
  | { ok: false; scope: "task"; message: string; resumeAt: null };

export function preflight(store: Store, config: Config, args: { agent: Agent; taskId: string; reserveUsd: number; capUsd?: number }): PreflightResult {
  const { effective: limits } = effectiveLimits(store, config);
  // A task's research depth can only lower its spend ceiling.
  const effective = { ...limits, perTaskUsd: tighter(limits.perTaskUsd, args.capUsd ?? null) };
  const r = args.reserveUsd;
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  const taskSpent = store.taskSpend(args.taskId);
  if (effective.perTaskUsd > 0 && taskSpent + r > effective.perTaskUsd) {
    return {
      ok: false,
      scope: "task",
      resumeAt: null,
      message: `Per-task budget: this task has spent ~${fmt(taskSpent)}; the next call could cost up to ~${fmt(r)}, exceeding the ${fmt(effective.perTaskUsd)} task limit.`,
    };
  }
  const today = store.spendSince(startOfUtcDay().toISOString());
  if (effective.dailyUsd > 0 && today + r > effective.dailyUsd) {
    return {
      ok: false,
      scope: "daily",
      resumeAt: nextUtcDay().toISOString(),
      message: `Daily budget: ~${fmt(today)} of ${fmt(effective.dailyUsd)} spent; the next call could cost up to ~${fmt(r)}. Paused until the UTC day resets.`,
    };
  }
  const month = store.spendSince(startOfUtcMonth().toISOString());
  if (effective.monthlyUsd > 0 && month + r > effective.monthlyUsd) {
    return {
      ok: false,
      scope: "monthly",
      resumeAt: nextUtcMonth().toISOString(),
      message: `Monthly budget: ~${fmt(month)} of ${fmt(effective.monthlyUsd)} spent; the next call could cost up to ~${fmt(r)}. Paused until next month.`,
    };
  }
  const cap = args.agent.dailyBudgetUsd;
  if (cap !== null && cap > 0) {
    const agentToday = store.spendSince(startOfUtcDay().toISOString(), args.agent.id);
    if (agentToday + r > cap) {
      return {
        ok: false,
        scope: "agent",
        resumeAt: nextUtcDay().toISOString(),
        message: `${args.agent.name}'s daily budget: ~${fmt(agentToday)} of ${fmt(cap)} spent; the next call could cost up to ~${fmt(r)}. Paused until the UTC day resets.`,
      };
    }
  }
  return { ok: true };
}
