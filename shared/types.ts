/**
 * Domain model shared by the server (source of truth) and the web client
 * (read-only consumer). Nothing in here is theme- or rendering-specific:
 * themes only ever see these types through the world snapshot.
 */

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
  /** Tool ids this agent is authorised to call (server-enforced allowlist). */
  tools: string[];
  avatar: AgentAvatar;
  /** Building the agent works from. */
  buildingId: string;
  status: AgentStatus;
  statusDetail: string | null;
  currentTaskId: string | null;
  enabled: boolean;
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
}

export interface Workflow {
  id: string;
  template: string;
  title: string;
  input: Record<string, string>;
  status: "running" | "completed" | "failed" | "cancelled";
  finalTaskId: string | null;
  createdAt: ISODate;
  completedAt: ISODate | null;
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
  | "task.tool_call"
  | "task.handoff"
  | "task.approval_requested"
  | "task.approval_resolved"
  | "task.completed"
  | "task.failed"
  | "task.retry_scheduled"
  | "task.cancelled"
  | "agent.status"
  | "agent.updated"
  | "workflow.created"
  | "workflow.completed"
  | "usage.recorded"
  | "system.notice";

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
  costUsd: number;
  simulated: boolean;
}

export interface TownTaxSettings {
  enabled: boolean;
  mode: "percent_of_cost" | "per_million_tokens";
  /** Percent (0-100) when mode = percent_of_cost; USD per 1M tokens otherwise. */
  rate: number;
  weeklyCapUsd: number;
  cause: string;
}

export interface TreasurySummary {
  totals: { inputTokens: number; outputTokens: number; costUsd: number; requests: number; webSearches: number };
  today: { costUsd: number; budgetUsd: number };
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

export interface SystemStatus {
  version: string;
  provider: {
    id: string;
    mode: ProviderMode;
    keyConfigured: boolean;
    refusalFallback: string;
  };
  worker: { running: boolean; concurrency: number; activeTasks: number };
  limits: { dailyBudgetUsd: number; maxTurnsPerTask: number; maxDelegationDepth: number };
  authRequired: boolean;
  models: ModelInfo[];
  tools: ToolInfo[];
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
}

export interface TownSettings {
  townName: string;
  themeId: string;
  townTax: TownTaxSettings;
}

export interface TownSnapshot {
  settings: TownSettings;
  agents: Agent[];
  stats: AgentStats[];
  buildings: Building[];
  tasks: Task[];
  approvals: Approval[];
  workflows: Workflow[];
  events: TownEvent[];
  status: SystemStatus;
}
