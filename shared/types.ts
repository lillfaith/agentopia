/**
 * Domain model shared by the server (source of truth) and the web client
 * (read-only consumer). Nothing in here is theme- or rendering-specific:
 * themes only ever see these types through the world snapshot.
 */

import type { Appearance, VoiceConfig } from "./cosmetics.js";

export type ISODate = string;

// ───────────────────────── Agents ─────────────────────────

/** Visible life-cycle state of an agent. Derived from real task execution. */
export type AgentStatus =
  | "idle"
  | "planning" // task claimed, building the request / waiting on first model response
  | "working" // model call or tool execution in flight
  | "delivering" // handing work to another agent
  | "waiting_approval" // blocked on a human decision
  | "completed" // just finished a task (transient, decays to idle)
  | "failed"; // last task failed (transient, decays to idle)

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentAvatar {
  /** Primary body colour (hex). Themes may reinterpret it. */
  color: string;
  /** Theme-agnostic accessory keyword: "crown" | "goggles" | "beret" | "none" | ... */
  accessory: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  personality: string;
  systemPrompt: string;
  responsibilities: string[];
  model: string;
  effort: Effort;
  /** Skill ids this agent may use. Skills bundle tools + guidance (server-enforced allowlist). */
  skills: string[];
  /** @deprecated kept in sync with `appearance` for older clients; use `appearance`. */
  avatar: AgentAvatar;
  /** Cosmetic identity (body, face, features, wearables). Never affects prompts, tools or cost. */
  appearance: Appearance;
  /** Speech-sound voice. Purely cosmetic and synthesized locally in the browser. */
  voice: VoiceConfig;
  /** Building the agent works from. */
  buildingId: string;
  status: AgentStatus;
  statusDetail: string | null;
  currentTaskId: string | null;
  enabled: boolean;
  /** Archived agents keep their history but leave the town. */
  archived: boolean;
  /** Optional per-agent daily spend cap (USD). null = only global caps apply. */
  dailyBudgetUsd: number | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface AgentStats {
  agentId: string;
  tasksCompleted: number;
  tasksFailed: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

// ───────────────────────── Buildings ─────────────────────────

/** A department of the AI company. Themes decide what it *looks* like via `kind`. */
export interface Building {
  id: string;
  name: string;
  department: string;
  /** Theme-agnostic archetype: "hq" | "research" | "studio" | ... */
  kind: string;
  /** Layout slot id; the active theme maps slots to world positions. */
  slot: string;
  description: string;
}

// ───────────────────────── Tasks ─────────────────────────

export type TaskStatus =
  | "blocked" // waiting for dependencies
  | "queued"
  | "running"
  | "waiting_approval"
  | "retry_wait" // failed attempt, will be retried after `runAfter`
  | "completed"
  | "failed"
  | "cancelled";

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ["completed", "failed", "cancelled"];

export type TaskPriority = 0 | 1 | 2 | 3; // low, normal, high, urgent
export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  0: "low",
  1: "normal",
  2: "high",
  3: "urgent",
};

export interface Task {
  id: string;
  title: string;
  instructions: string;
  agentId: string;
  status: TaskStatus;
  priority: TaskPriority;
  dependsOn: string[];
  parentTaskId: string | null;
  workflowId: string | null;
  /** "user" or the id of the delegating agent. */
  createdBy: string;
  delegationDepth: number;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  output: string | null;
  /** Earliest time a worker may pick this task up (used for retries). */
  runAfter: ISODate | null;
  createdAt: ISODate;
  startedAt: ISODate | null;
  completedAt: ISODate | null;
  updatedAt: ISODate;
  /** True when produced by the offline simulation provider. */
  simulated: boolean;
  /** Schedule that created this task, if any. */
  scheduleId: string | null;
  /** Project this task belongs to, if any. */
  projectId: string | null;
  /** "task" = assigned work; "chat" = a free-form conversation with the villager. */
  kind: TaskKind;
  /** Research depth chosen for this task; null = the town's default. */
  depth: ResearchDepth | null;
  /** Model chosen for this task; null = the villager's own model (or the depth's choice). */
  modelOverride: string | null;
  /** Proof of execution, derived from recorded API usage. */
  execution: TaskExecution;
}

/**
 * How much research a task may do. Each depth sets limits on web searches, page reads,
 * retrieved page size, model turns, context size and spend (see server/engine/depth.ts).
 */
export type ResearchDepth = "quick" | "standard" | "deep";

export type TaskKind = "task" | "chat";

/**
 * One message in a task's conversation with the owner. "brief" is the work as assigned,
 * "owner" a reply from the owner, "agent" the villager's answer (its output at that point).
 */
export interface TaskMessage {
  id: number;
  taskId: string;
  role: "brief" | "owner" | "agent";
  content: string;
  createdAt: ISODate;
}

/** One recorded model call of a task, with its cost split by charge. */
export interface TaskUsageCall {
  id: number;
  ts: ISODate;
  model: string;
  requestedModel: string | null;
  requestId: string | null;
  simulated: boolean;
  freshInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  /** Part of outputTokens spent on reasoning (null for calls recorded before this was tracked). */
  thinkingTokens: number | null;
  /** Sampling iterations inside the call (a server-side search loop can run several). */
  serverIterations: number | null;
  /** Largest single prompt the model read in this call, in tokens. */
  contextTokens: number | null;
  webSearches: number;
  webFetches: number;
  costUsd: number;
  cost: UsageCostSplit;
}

export interface UsageCostSplit {
  freshInputUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
  outputUsd: number;
  webSearchUsd: number;
  /** Sum of the parts, recomputed from the price table. */
  totalUsd: number;
}

/** GET /api/tasks/:id/usage — every recorded call of one task and the totals. */
export interface TaskUsageBreakdown {
  taskId: string;
  depth: ResearchDepth | null;
  models: string[];
  calls: TaskUsageCall[];
  totals: {
    apiCalls: number;
    serverIterations: number;
    freshInputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    /** Every token above added together, as the town's token counter shows it. */
    allTokens: number;
    webSearches: number;
    webFetches: number;
    peakContextTokens: number;
  };
  cost: UsageCostSplit & {
    /** What the treasury recorded for this task. */
    recordedUsd: number;
  };
  /** Cache hit rate: cache reads / all input tokens. */
  cacheHitRate: number;
  notes: string[];
}

/**
 * How a task was actually executed. "live" means at least one real Claude API
 * response with a request id was recorded for it.
 */
export interface TaskExecution {
  mode: "live" | "simulated" | "none";
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  models: string[];
  lastRequestId: string | null;
}

export interface Workflow {
  id: string;
  template: string;
  title: string;
  input: Record<string, string>;
  status: "running" | "completed" | "failed" | "cancelled";
  finalTaskId: string | null;
  scheduleId: string | null;
  projectId: string | null;
  createdAt: ISODate;
  completedAt: ISODate | null;
}

// ───────────────────────── Schedules ─────────────────────────

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO: 1 = Monday … 7 = Sunday

export type Cadence =
  | { kind: "interval"; everyMinutes: number }
  | { kind: "daily"; time: string } // "HH:MM" in the schedule's timezone
  | { kind: "weekly"; days: Weekday[]; time: string };

export type ScheduleTarget =
  | { type: "task"; agentId: string; title: string; instructions: string; priority: TaskPriority }
  | { type: "campaign"; topic: string; audience: string; goal: string };

export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  cadence: Cadence;
  /** IANA timezone, e.g. "Europe/London". */
  timezone: string;
  target: ScheduleTarget;
  /** What to do if the previous run is still in progress. */
  overlap: "skip" | "queue";
  nextRunAt: ISODate | null;
  lastRunAt: ISODate | null;
  lastOutcome: string | null;
  /** Most recent task or workflow created by this schedule. */
  lastTaskId: string | null;
  lastWorkflowId: string | null;
  runCount: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ───────────────────────── Approvals ─────────────────────────

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Approval {
  id: string;
  taskId: string;
  agentId: string;
  toolId: string;
  toolUseId: string;
  /** Human-readable summary of what the agent wants to do. */
  summary: string;
  input: unknown;
  status: ApprovalStatus;
  decidedAt: ISODate | null;
  note: string | null;
  createdAt: ISODate;
}

// ───────────────────────── Events ─────────────────────────

export type EventType =
  | "task.created"
  | "task.unblocked"
  | "task.started"
  | "task.step"
  | "task.progress"
  | "task.tool_call"
  | "task.handoff"
  | "task.approval_requested"
  | "task.approval_resolved"
  | "task.completed"
  | "task.failed"
  | "task.retry_scheduled"
  | "task.cancelled"
  | "task.message"
  | "agent.status"
  | "agent.updated"
  | "agent.created"
  | "agent.archived"
  | "building.created"
  | "building.updated"
  | "building.deleted"
  | "workflow.created"
  | "workflow.completed"
  | "schedule.fired"
  | "schedule.skipped"
  | "budget.hold"
  | "usage.recorded"
  | "system.verification"
  | "system.notice"
  | "reward.earned";

export interface TownEvent {
  id: number;
  ts: ISODate;
  type: EventType;
  agentId: string | null;
  taskId: string | null;
  message: string;
  data: Record<string, unknown>;
  simulated: boolean;
}

// ───────────────────────── Usage / Treasury ─────────────────────────

export interface UsageRecord {
  id: number;
  ts: ISODate;
  agentId: string;
  taskId: string | null;
  /** Model that actually served the request (may differ from requested on fallback). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearchRequests: number;
  webFetchRequests: number;
  /** Number of hosted code-execution tool uses in this response. */
  codeExecutions: number;
  costUsd: number;
  simulated: boolean;
  /** Anthropic request id — proof that a real API call happened. */
  requestId: string | null;
  /** Model the agent asked for (servedModel may differ after a refusal fallback). */
  requestedModel: string | null;
  /** Reasoning tokens included in outputTokens (null when not reported). */
  thinkingTokens?: number | null;
  /** Sampling iterations inside this call (server-side tool loops run several). */
  serverIterations?: number | null;
  /** Largest single prompt read in this call, in tokens. */
  contextTokens?: number | null;
}

export interface TownTaxSettings {
  enabled: boolean;
  mode: "percent_of_cost" | "per_million_tokens";
  /** Percent (0-100) when mode = percent_of_cost; USD per 1M tokens otherwise. */
  rate: number;
  weeklyCapUsd: number;
  cause: string;
}

export interface BudgetLimits {
  dailyUsd: number;
  monthlyUsd: number;
  perTaskUsd: number;
}

export interface BudgetStatus {
  /** Ceilings set by the server operator (environment). The UI can only lower them. */
  hard: BudgetLimits;
  /** Owner-set limits from settings (null = use the hard ceiling). */
  soft: { dailyUsd: number | null; monthlyUsd: number | null; perTaskUsd: number | null };
  /** min(hard, soft); 0 = unlimited. */
  effective: BudgetLimits;
  spent: { todayUsd: number; monthUsd: number };
  /** True when new model calls are currently paused by a global cap. */
  globalHold: boolean;
  /** Agents paused by their own daily cap. */
  agentHolds: string[];
  resetsAt: { day: ISODate; month: ISODate };
}

export interface TreasurySummary {
  totals: { inputTokens: number; outputTokens: number; costUsd: number; requests: number; webSearches: number; webFetches: number; codeExecutions: number; liveRequests: number };
  today: { costUsd: number; budgetUsd: number };
  budget: BudgetStatus;
  /** Projected monthly cost of enabled schedules, from their recent run costs. */
  scheduleProjections: Array<{ scheduleId: string; name: string; runsPerMonth: number; avgRunCostUsd: number | null; projectedMonthlyUsd: number | null }>;
  byAgent: Array<{ agentId: string; inputTokens: number; outputTokens: number; costUsd: number; requests: number }>;
  byModel: Array<{ model: string; inputTokens: number; outputTokens: number; costUsd: number; requests: number }>;
  daily: Array<{ day: string; costUsd: number; tokens: number }>;
  townTax: {
    settings: TownTaxSettings;
    weekStart: string;
    weekCostUsd: number;
    weekTokens: number;
    /** Suggested voluntary pledge. Nothing is ever charged automatically. */
    suggestedPledgeUsd: number;
    capped: boolean;
  };
  pricingNote: string;
}

// ───────────────────────── System / settings ─────────────────────────

export type ProviderMode = "live" | "simulation" | "unconfigured";

export interface WorkerInfo {
  id: string;
  role: "all" | "worker";
  hostname: string;
  pid: number;
  startedAt: ISODate;
  lastSeen: ISODate;
  activeTasks: number;
  alive: boolean;
}

export interface Verification {
  id: number;
  ts: ISODate;
  checkId: string;
  ok: boolean;
  detail: string;
  requestId: string | null;
  model: string | null;
  costUsd: number;
  source: "connection-test" | "verify-live";
}

export interface SystemStatus {
  version: string;
  /** Which roles this API process runs. Workers may also run as separate processes. */
  role: "all" | "api";
  provider: {
    id: string;
    mode: ProviderMode;
    keyConfigured: boolean;
    refusalFallback: string;
    /** Set only when requests go to a non-default API host (e.g. a corporate proxy). */
    baseUrlHost: string | null;
  };
  worker: { running: boolean; concurrency: number; activeTasks: number };
  workers: WorkerInfo[];
  limits: { dailyBudgetUsd: number; maxTurnsPerTask: number; maxDelegationDepth: number; minScheduleIntervalMinutes: number };
  budget: BudgetStatus;
  authRequired: boolean;
  models: ModelInfo[];
  /** Models the owner's plan allows; null = all of them. */
  allowedModels: string[] | null;
  /** Research depths a task can choose (limits shown in the composer). */
  depths: { id: ResearchDepth; label: string; description: string; maxSearches: number; maxFetches: number; maxTaskUsd: number }[];
  skills: SkillInfo[];
  /** Latest result per verification check. */
  verifications: Verification[];
}

export interface ModelInfo {
  id: string;
  label: string;
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface ToolInfo {
  id: string;
  label: string;
  description: string;
  /** Sensitive tools always pause for explicit human approval. */
  requiresApproval: boolean;
  /** "real" = executes for real; "placeholder" = records intent only. */
  implementation: "real" | "placeholder";
  /** "local" runs on this server; "hosted" runs on Anthropic's infrastructure. */
  runsOn: "local" | "hosted";
}

export type SkillCategory = "research" | "writing" | "coordination" | "coding" | "publishing" | "communication" | "media" | "3d";

export interface SkillInfo {
  id: string;
  label: string;
  icon: string;
  category: SkillCategory;
  description: string;
  /** "available" can be enabled; "planned" is a declared slot with no integration yet. */
  status: "available" | "planned";
  tools: ToolInfo[];
  costNote: string;
  /** Id of the verify:live check that proves this skill works, if any. */
  verificationCheck: string | null;
}

export interface AgentTemplate {
  id: string;
  role: string;
  icon: string;
  description: string;
  personality: string;
  systemPrompt: string;
  responsibilities: string[];
  skills: string[];
  effort: Effort;
  avatar: AgentAvatar;
  /** Suggested building style for a matching department. */
  buildingKind: string;
  department: string;
}

export interface TownSettings {
  townName: string;
  themeId: string;
  townTax: TownTaxSettings;
  /** Owner budget limits; can only be lower than the operator's hard ceilings. */
  budget: { dailyUsd: number | null; monthlyUsd: number | null; perTaskUsd: number | null };
  /** Town IANA timezone: drives the in-game clock/lighting and is the default for new schedules. */
  timezone: string;
  /** "auto" = follow the owner's browser timezone; "manual" = keep `timezone` as chosen. */
  timezoneMode: "auto" | "manual";
  /** Emergency stop: when true no task starts and no schedule fires until the owner resumes. */
  paused: boolean;
  /** Research depth for new tasks that don't choose one. */
  defaultDepth: ResearchDepth;
}

// ───────────────────────── Projects ─────────────────────────

export type ProjectStatus = "active" | "archived";

/** A goal the owner is working towards; groups related tasks and workflows. */
export interface Project {
  id: string;
  title: string;
  goal: string;
  status: ProjectStatus;
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ───────────────────────── Memory ─────────────────────────

/** A note an agent chose to remember; shown to it in later briefs. The owner can read and delete every note. */
export interface AgentMemory {
  id: string;
  agentId: string;
  content: string;
  sourceTaskId: string | null;
  createdAt: ISODate;
}

// ───────────────────────── Rewards ─────────────────────────

/** Town coins: earned only for verified work, spent on cosmetics. No cash value; never purchasable or withdrawable. */
export interface CoinEntry {
  id: number;
  ts: ISODate;
  amount: number;
  reason: string;
  ref: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  coins: number;
  unlockedAt: ISODate | null;
}

export interface RewardsSummary {
  balance: number;
  /** Coins earned from tasks today (UTC), counted against the daily cap. */
  earnedToday: number;
  dailyCap: number;
  owned: string[];
}

export interface TownSnapshot {
  settings: TownSettings;
  projects: Project[];
  rewards: RewardsSummary;
  agents: Agent[];
  stats: AgentStats[];
  buildings: Building[];
  tasks: Task[];
  approvals: Approval[];
  workflows: Workflow[];
  schedules: Schedule[];
  events: TownEvent[];
  status: SystemStatus;
  templates: AgentTemplate[];
}
