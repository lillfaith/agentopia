import type { AIProvider, Agent, Effort, ModelPreference, ResearchDepth, Task } from "../../shared/types.js";
import type { HostedTool } from "../llm/provider.js";
import { modelSpec, priceSpec, type CustomPrices } from "../llm/models.js";

/**
 * Research depth: how much web research one task may do, and what it may spend.
 *
 * Web searches are the largest single charge on a research task ($0.01 each; a
 * 5-search task on Sonnet spends ~45% of its cost on them), followed by output
 * (incl. reasoning) and the search results the model re-reads on every step.
 * The limits below bound each of those. They are TIGHTER than the operator's and
 * plan's limits, never looser: the per-task cap is min(plan, owner, depth).
 */
export interface DepthProfile {
  id: ResearchDepth;
  label: string;
  description: string;
  /** Web searches for the whole task (sent as the tool's max_uses, minus what was already used). */
  maxSearches: number;
  /** Page reads for the whole task. */
  maxFetches: number;
  /** Largest page a read may bring into context, in tokens (web_fetch max_content_tokens). */
  fetchMaxContentTokens: number;
  /** Model calls before the villager must write up what it has. */
  maxTurns: number;
  /** Once a call's prompt grows past this many tokens, the next call is the write-up. */
  maxContextTokens: number;
  /** Spend ceiling for one task at this depth on Sonnet-priced models, in USD (see depthSpendCap). */
  maxTaskUsd: number;
  /** Highest reasoning effort used at this depth (the villager's own setting if lower). */
  effortCap: Effort;
  /** Prefer the cheapest allowed model unless the task picks one. */
  preferCheapModel: boolean;
}

export const DEPTHS: Record<ResearchDepth, DepthProfile> = {
  quick: {
    id: "quick",
    label: "Quick",
    description: "A fast answer from a few searches. Uses the cheapest model unless you pick one.",
    maxSearches: 3,
    maxFetches: 2,
    fetchMaxContentTokens: 4_000,
    maxTurns: 3,
    maxContextTokens: 40_000,
    maxTaskUsd: 0.15,
    effortCap: "low",
    preferCheapModel: true,
  },
  standard: {
    id: "standard",
    label: "Standard",
    description: "A sourced brief: answers from knowledge where that's reliable, searches to verify and cite.",
    maxSearches: 4,
    maxFetches: 3,
    fetchMaxContentTokens: 8_000,
    maxTurns: 5,
    maxContextTokens: 90_000,
    maxTaskUsd: 0.35,
    effortCap: "medium",
    preferCheapModel: false,
  },
  deep: {
    id: "deep",
    label: "Deep",
    description: "Thorough research for hard questions: more searches, longer pages, more spend.",
    maxSearches: 12,
    maxFetches: 10,
    fetchMaxContentTokens: 16_000,
    maxTurns: 8,
    maxContextTokens: 180_000,
    maxTaskUsd: 1.5,
    effortCap: "max",
    preferCheapModel: false,
  },
};

export const DEPTH_IDS = Object.keys(DEPTHS) as ResearchDepth[];

export function isResearchDepth(v: unknown): v is ResearchDepth {
  return typeof v === "string" && v in DEPTHS;
}

const REFERENCE_MODEL = "claude-sonnet-5-5";

/**
 * The depth's spend ceiling for a model. Ceilings are set for Sonnet; pricier models get a
 * proportionally higher one (a single Opus call can reserve twice what a Sonnet call does),
 * cheaper models keep the Sonnet ceiling. Plan and owner limits still apply on top.
 */
export function depthSpendCap(depth: DepthProfile, model: string, custom?: CustomPrices): number {
  const ratio = priceSpec(model, custom).outputPerMTok / modelSpec(REFERENCE_MODEL).outputPerMTok;
  return Math.round(depth.maxTaskUsd * Math.max(1, ratio) * 100) / 100;
}

const EFFORT_ORDER: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function capEffort(effort: Effort, cap: Effort): Effort {
  return EFFORT_ORDER.indexOf(effort) <= EFFORT_ORDER.indexOf(cap) ? effort : cap;
}

/** Depth limits apply to tasks whose villager can search or read the web. */
export function usesWebResearch(hosted: HostedTool[]): boolean {
  return hosted.includes("web_search") || hosted.includes("web_fetch");
}

/** Cheapest model first; used when a Quick task doesn't name one. */
const CHEAP_ORDER = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"];

export interface TaskRunPlan {
  depth: DepthProfile;
  model: string;
  effort: Effort;
  /** Why the model differs from the villager's own, for the activity feed. */
  modelReason: string | null;
}

/**
 * Decide the model and effort for one task run.
 *  - A model picked on the task wins (if the plan allows it).
 *  - Otherwise the town's model preference decides (the employee's own model is never changed):
 *      economy  → the cheapest allowed model for every task;
 *      balanced → the cheapest allowed model for Quick research, the employee's model otherwise;
 *      quality  → always the employee's model.
 *  - Effort is the villager's, capped by the depth (research effort curves are nearly flat:
 *    medium matches high on knowledge work for noticeably less).
 */
export function planTaskRun(
  task: Pick<Task, "depth" | "modelOverride">,
  agent: Pick<Agent, "model" | "effort">,
  opts: { defaultDepth: ResearchDepth; allowedModels: string[] | null; research: boolean; provider?: AIProvider; preference?: ModelPreference },
): TaskRunPlan {
  const preference = opts.preference ?? "balanced";
  const depth = DEPTHS[task.depth ?? opts.defaultDepth] ?? DEPTHS.standard;
  // Model choices below are Claude models: other providers keep the villager's own model.
  if (opts.provider && opts.provider !== "anthropic") {
    return { depth, model: agent.model, effort: opts.research ? capEffort(agent.effort, depth.effortCap) : agent.effort, modelReason: null };
  }
  const allowed = (m: string) => !opts.allowedModels || opts.allowedModels.includes(m);
  const cheaper = () => {
    const cheap = CHEAP_ORDER.find((m) => allowed(m));
    return cheap && CHEAP_ORDER.indexOf(cheap) < CHEAP_ORDER.indexOf(agent.model) ? cheap : null;
  };
  if (!opts.research) {
    if (task.modelOverride && allowed(task.modelOverride)) return { depth, model: task.modelOverride, effort: agent.effort, modelReason: null };
    const cheap = preference === "economy" ? cheaper() : null;
    return cheap ? { depth, model: cheap, effort: agent.effort, modelReason: "Economy mode uses the lower-cost model" } : { depth, model: agent.model, effort: agent.effort, modelReason: null };
  }
  if (task.modelOverride && allowed(task.modelOverride)) {
    return { depth, model: task.modelOverride, effort: capEffort(agent.effort, depth.effortCap), modelReason: task.modelOverride !== agent.model ? "chosen for this task" : null };
  }
  const wantsCheap = preference === "economy" ? depth.id !== "deep" : preference === "balanced" ? depth.preferCheapModel : false;
  const cheap = wantsCheap ? cheaper() : null;
  if (cheap) {
    return { depth, model: cheap, effort: capEffort(agent.effort, depth.effortCap), modelReason: preference === "economy" ? "Economy mode uses the lower-cost model" : `${depth.label} research uses the lower-cost model` };
  }
  return { depth, model: agent.model, effort: capEffort(agent.effort, depth.effortCap), modelReason: null };
}
