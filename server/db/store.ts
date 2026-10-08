import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  Agent,
  AgentStats,
  AgentStatus,
  Approval,
  ApprovalStatus,
  Building,
  EventType,
  Task,
  TaskPriority,
  TaskStatus,
  TownEvent,
  TownSettings,
  UsageRecord,
  Workflow,
} from "../../shared/types.js";
import { transaction, type Database } from "./database.js";

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
const json = (v: unknown) => JSON.stringify(v ?? null);
const parse = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

export const DEFAULT_SETTINGS: TownSettings = {
  townName: "Agentopia",
  themeId: "pastel-village",
  townTax: {
    enabled: false,
    mode: "percent_of_cost",
    rate: 5,
    weeklyCapUsd: 10,
    cause: "Wildlife & habitat conservation (choose your own charity)",
  },
};

// ───────────────────────── row mappers ─────────────────────────

function toAgent(r: Row): Agent {
  return {
    id: r.id as string,
    name: r.name as string,
    role: r.role as string,
    personality: r.personality as string,
    systemPrompt: r.system_prompt as string,
    responsibilities: parse(r.responsibilities, []),
    model: r.model as string,
    effort: r.effort as Agent["effort"],
    tools: parse(r.tools, []),
    avatar: parse(r.avatar, { color: "#f9a8d4", accessory: "none" }),
    buildingId: r.building_id as string,
    status: r.status as AgentStatus,
    statusDetail: (r.status_detail as string) ?? null,
    currentTaskId: (r.current_task_id as string) ?? null,
    enabled: r.enabled === 1,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function toTask(r: Row): Task {
  return {
    id: r.id as string,
    title: r.title as string,
    instructions: r.instructions as string,
    agentId: r.agent_id as string,
    status: r.status as TaskStatus,
    priority: Number(r.priority) as TaskPriority,
    dependsOn: parse(r.depends_on, []),
    parentTaskId: (r.parent_task_id as string) ?? null,
    workflowId: (r.workflow_id as string) ?? null,
    createdBy: r.created_by as string,
    delegationDepth: Number(r.delegation_depth),
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    lastError: (r.last_error as string) ?? null,
    output: (r.output as string) ?? null,
    runAfter: (r.run_after as string) ?? null,
    createdAt: r.created_at as string,
    startedAt: (r.started_at as string) ?? null,
    completedAt: (r.completed_at as string) ?? null,
    updatedAt: r.updated_at as string,
    simulated: r.simulated === 1,
  };
}

function toWorkflow(r: Row): Workflow {
  return {
    id: r.id as string,
    template: r.template as string,
    title: r.title as string,
    input: parse(r.input, {}),
    status: r.status as Workflow["status"],
    finalTaskId: (r.final_task_id as string) ?? null,
    createdAt: r.created_at as string,
    completedAt: (r.completed_at as string) ?? null,
  };
}

function toApproval(r: Row): Approval {
  return {
    id: r.id as string,
    taskId: r.task_id as string,
    agentId: r.agent_id as string,
    toolId: r.tool_id as string,
    toolUseId: r.tool_use_id as string,
    summary: r.summary as string,
    input: parse(r.input, null),
    status: r.status as ApprovalStatus,
    decidedAt: (r.decided_at as string) ?? null,
    note: (r.note as string) ?? null,
    createdAt: r.created_at as string,
  };
}

function toEvent(r: Row): TownEvent {
  return {
    id: Number(r.id),
    ts: r.ts as string,
    type: r.type as EventType,
    agentId: (r.agent_id as string) ?? null,
    taskId: (r.task_id as string) ?? null,
    message: r.message as string,
    data: parse(r.data, {}),
    simulated: r.simulated === 1,
  };
}

// ───────────────────────── store ─────────────────────────

export interface NewTask {
  title: string;
  instructions: string;
  agentId: string;
  priority?: TaskPriority;
  dependsOn?: string[];
  parentTaskId?: string | null;
  workflowId?: string | null;
  createdBy: string;
  delegationDepth?: number;
  maxAttempts?: number;
}

export interface NewEvent {
  type: EventType;
  message: string;
  agentId?: string | null;
  taskId?: string | null;
  data?: Record<string, unknown>;
  simulated?: boolean;
}

/**
 * The single persistence gateway. All state changes go through here so that
 * every change can be mirrored to the event log / live stream.
 */
export class Store {
  /** Emits "event" (TownEvent) for every persisted event. */
  readonly bus = new EventEmitter();

  constructor(readonly db: Database) {
    this.bus.setMaxListeners(200);
  }

  // ── settings ──
  getSettings(): TownSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'town'").get() as Row | undefined;
    const stored = parse<Partial<TownSettings>>(row?.value, {});
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      townTax: { ...DEFAULT_SETTINGS.townTax, ...(stored.townTax ?? {}) },
    };
  }

  updateSettings(patch: Partial<TownSettings>): TownSettings {
    const current = this.getSettings();
    const next: TownSettings = {
      ...current,
      ...patch,
      townTax: { ...current.townTax, ...(patch.townTax ?? {}) },
    };
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES ('town', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(json(next));
    return next;
  }

  // ── buildings ──
  listBuildings(): Building[] {
    return (this.db.prepare("SELECT * FROM buildings ORDER BY id").all() as Row[]).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      department: r.department as string,
      kind: r.kind as string,
      slot: r.slot as string,
      description: r.description as string,
    }));
  }

  upsertBuilding(b: Building): void {
    this.db
      .prepare(
        `INSERT INTO buildings (id, name, department, kind, slot, description) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, department=excluded.department, kind=excluded.kind,
           slot=excluded.slot, description=excluded.description`,
      )
      .run(b.id, b.name, b.department, b.kind, b.slot, b.description);
  }

  // ── agents ──
  listAgents(): Agent[] {
    return (this.db.prepare("SELECT * FROM agents ORDER BY created_at, rowid").all() as Row[]).map(toAgent);
  }

  getAgent(id: string): Agent | null {
    const r = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Row | undefined;
    return r ? toAgent(r) : null;
  }

  insertAgent(a: Omit<Agent, "createdAt" | "updatedAt" | "status" | "statusDetail" | "currentTaskId">): Agent {
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO agents (id, name, role, personality, system_prompt, responsibilities, model, effort, tools, avatar,
           building_id, status, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?)`,
      )
      .run(
        a.id, a.name, a.role, a.personality, a.systemPrompt, json(a.responsibilities), a.model, a.effort,
        json(a.tools), json(a.avatar), a.buildingId, a.enabled ? 1 : 0, ts, ts,
      );
    return this.getAgent(a.id)!;
  }

  updateAgent(
    id: string,
    patch: Partial<Pick<Agent, "name" | "role" | "personality" | "systemPrompt" | "responsibilities" | "model" | "effort" | "tools" | "avatar" | "enabled">>,
  ): Agent | null {
    const cols: string[] = [];
    const vals: (string | number)[] = [];
    const map: Record<string, [string, (v: never) => string | number]> = {
      name: ["name", (v: string) => v],
      role: ["role", (v: string) => v],
      personality: ["personality", (v: string) => v],
      systemPrompt: ["system_prompt", (v: string) => v],
      responsibilities: ["responsibilities", (v: string[]) => json(v)],
      model: ["model", (v: string) => v],
      effort: ["effort", (v: string) => v],
      tools: ["tools", (v: string[]) => json(v)],
      avatar: ["avatar", (v: object) => json(v)],
      enabled: ["enabled", (v: boolean) => (v ? 1 : 0)],
    };
    for (const [key, value] of Object.entries(patch)) {
      const m = map[key];
      if (!m || value === undefined) continue;
      cols.push(`${m[0]} = ?`);
      vals.push(m[1](value as never));
    }
    if (cols.length) {
      cols.push("updated_at = ?");
      vals.push(now(), id);
      this.db.prepare(`UPDATE agents SET ${cols.join(", ")} WHERE id = ?`).run(...vals);
    }
    return this.getAgent(id);
  }

  /** Update the visible state of an agent and broadcast it. */
  setAgentStatus(id: string, status: AgentStatus, detail: string | null, currentTaskId: string | null, simulated = false): void {
    this.db
      .prepare("UPDATE agents SET status = ?, status_detail = ?, current_task_id = ?, updated_at = ? WHERE id = ?")
      .run(status, detail, currentTaskId, now(), id);
    this.addEvent({
      type: "agent.status",
      agentId: id,
      taskId: currentTaskId,
      message: detail ?? status,
      data: { status },
      simulated,
    });
  }

  agentStats(): AgentStats[] {
    const rows = this.db
      .prepare(
        `SELECT a.id AS agent_id,
           (SELECT COUNT(*) FROM tasks t WHERE t.agent_id = a.id AND t.status = 'completed') AS completed,
           (SELECT COUNT(*) FROM tasks t WHERE t.agent_id = a.id AND t.status = 'failed') AS failed,
           COALESCE((SELECT SUM(input_tokens + cache_read_tokens + cache_write_tokens) FROM usage u WHERE u.agent_id = a.id), 0) AS input_tokens,
           COALESCE((SELECT SUM(output_tokens) FROM usage u WHERE u.agent_id = a.id), 0) AS output_tokens,
           COALESCE((SELECT SUM(cost_usd) FROM usage u WHERE u.agent_id = a.id), 0) AS cost
         FROM agents a`,
      )
      .all() as Row[];
    return rows.map((r) => ({
      agentId: r.agent_id as string,
      tasksCompleted: Number(r.completed),
      tasksFailed: Number(r.failed),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      costUsd: Number(r.cost),
    }));
  }

  // ── workflows ──
  insertWorkflow(w: Omit<Workflow, "createdAt" | "completedAt" | "status">): Workflow {
    this.db
      .prepare("INSERT INTO workflows (id, template, title, input, status, final_task_id, created_at) VALUES (?, ?, ?, ?, 'running', ?, ?)")
      .run(w.id, w.template, w.title, json(w.input), w.finalTaskId, now());
    return this.getWorkflow(w.id)!;
  }

  setWorkflowFinalTask(id: string, taskId: string): void {
    this.db.prepare("UPDATE workflows SET final_task_id = ? WHERE id = ?").run(taskId, id);
  }

  getWorkflow(id: string): Workflow | null {
    const r = this.db.prepare("SELECT * FROM workflows WHERE id = ?").get(id) as Row | undefined;
    return r ? toWorkflow(r) : null;
  }

  listWorkflows(limit = 50): Workflow[] {
    return (this.db.prepare("SELECT * FROM workflows ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as Row[]).map(toWorkflow);
  }

  setWorkflowStatus(id: string, status: Workflow["status"]): void {
    this.db
      .prepare("UPDATE workflows SET status = ?, completed_at = CASE WHEN ? = 'running' THEN NULL ELSE ? END WHERE id = ?")
      .run(status, status, now(), id);
  }

  // ── tasks ──
  createTask(t: NewTask): Task {
    const id = randomUUID();
    const ts = now();
    const deps = t.dependsOn ?? [];
    const pendingDeps = deps.filter((d) => this.getTask(d)?.status !== "completed");
    const status: TaskStatus = pendingDeps.length ? "blocked" : "queued";
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, instructions, agent_id, status, priority, depends_on, parent_task_id, workflow_id,
           created_by, delegation_depth, max_attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, t.title, t.instructions, t.agentId, status, t.priority ?? 1, json(deps), t.parentTaskId ?? null,
        t.workflowId ?? null, t.createdBy, t.delegationDepth ?? 0, t.maxAttempts ?? 3, ts, ts,
      );
    return this.getTask(id)!;
  }

  getTask(id: string): Task | null {
    const r = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Row | undefined;
    return r ? toTask(r) : null;
  }

  listTasks(opts: { agentId?: string; workflowId?: string; limit?: number } = {}): Task[] {
    const where: string[] = [];
    const vals: (string | number)[] = [];
    if (opts.agentId) {
      where.push("agent_id = ?");
      vals.push(opts.agentId);
    }
    if (opts.workflowId) {
      where.push("workflow_id = ?");
      vals.push(opts.workflowId);
    }
    vals.push(opts.limit ?? 200);
    const sql = `SELECT * FROM tasks ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC, rowid DESC LIMIT ?`;
    return (this.db.prepare(sql).all(...vals) as Row[]).map(toTask);
  }

  /**
   * Atomically claim the next runnable task. An agent works on one task at a time,
   * mirroring the one-character-one-job metaphor. Higher priority first, then FIFO.
   */
  claimNextTask(workerId: string, leaseMs: number): Task | null {
    return transaction(this.db, () => {
      const ts = now();
      const row = this.db
        .prepare(
          `SELECT t.id FROM tasks t JOIN agents a ON a.id = t.agent_id
           WHERE t.status IN ('queued', 'retry_wait')
             AND (t.run_after IS NULL OR t.run_after <= ?)
             AND a.enabled = 1
             AND NOT EXISTS (SELECT 1 FROM tasks r WHERE r.agent_id = t.agent_id AND r.status = 'running')
           ORDER BY t.priority DESC, t.created_at ASC, t.rowid ASC
           LIMIT 1`,
        )
        .get(ts) as Row | undefined;
      if (!row) return null;
      const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
      this.db
        .prepare(
          `UPDATE tasks SET status = 'running', attempts = attempts + 1, lease_owner = ?, lease_until = ?,
             started_at = COALESCE(started_at, ?), run_after = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(workerId, leaseUntil, ts, ts, row.id as string);
      return this.getTask(row.id as string);
    });
  }

  /** True if some task is claimable right now (read-only). */
  claimNextTaskPreview(): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM tasks t JOIN agents a ON a.id = t.agent_id
         WHERE t.status IN ('queued', 'retry_wait') AND (t.run_after IS NULL OR t.run_after <= ?) AND a.enabled = 1 LIMIT 1`,
      )
      .get(now());
    return !!row;
  }

  renewLease(taskId: string, workerId: string, leaseMs: number): boolean {
    const res = this.db
      .prepare("UPDATE tasks SET lease_until = ? WHERE id = ? AND lease_owner = ? AND status = 'running'")
      .run(new Date(Date.now() + leaseMs).toISOString(), taskId, workerId);
    return Number(res.changes) > 0;
  }

  /** Crash recovery: tasks whose worker vanished go back to the queue. */
  requeueExpiredLeases(): Task[] {
    const ts = now();
    const rows = this.db
      .prepare("SELECT id FROM tasks WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until < ?")
      .all(ts) as Row[];
    for (const r of rows) {
      this.db
        .prepare("UPDATE tasks SET status = 'queued', lease_owner = NULL, lease_until = NULL, updated_at = ? WHERE id = ?")
        .run(ts, r.id as string);
    }
    return rows.map((r) => this.getTask(r.id as string)!);
  }

  updateTask(
    id: string,
    patch: Partial<{
      status: TaskStatus;
      output: string | null;
      lastError: string | null;
      runAfter: string | null;
      completedAt: string | null;
      simulated: boolean;
      releaseLease: boolean;
      attempts: number;
    }>,
  ): Task {
    const cols: string[] = ["updated_at = ?"];
    const vals: (string | number | null)[] = [now()];
    if (patch.status !== undefined) (cols.push("status = ?"), vals.push(patch.status));
    if (patch.output !== undefined) (cols.push("output = ?"), vals.push(patch.output));
    if (patch.lastError !== undefined) (cols.push("last_error = ?"), vals.push(patch.lastError));
    if (patch.runAfter !== undefined) (cols.push("run_after = ?"), vals.push(patch.runAfter));
    if (patch.completedAt !== undefined) (cols.push("completed_at = ?"), vals.push(patch.completedAt));
    if (patch.simulated !== undefined) (cols.push("simulated = ?"), vals.push(patch.simulated ? 1 : 0));
    if (patch.attempts !== undefined) (cols.push("attempts = ?"), vals.push(patch.attempts));
    if (patch.releaseLease) cols.push("lease_owner = NULL", "lease_until = NULL");
    vals.push(id);
    this.db.prepare(`UPDATE tasks SET ${cols.join(", ")} WHERE id = ?`).run(...vals);
    return this.getTask(id)!;
  }

  /** Provider transcript + executor bookkeeping for a task (opaque to the store). */
  getConversation<T>(taskId: string): T | null {
    const r = this.db.prepare("SELECT conversation FROM tasks WHERE id = ?").get(taskId) as Row | undefined;
    return r?.conversation ? parse<T | null>(r.conversation, null) : null;
  }

  saveConversation(taskId: string, state: unknown): void {
    this.db.prepare("UPDATE tasks SET conversation = ?, updated_at = ? WHERE id = ?").run(state === null ? null : json(state), now(), taskId);
  }

  /** Tasks that list `taskId` as a dependency. */
  dependentsOf(taskId: string): Task[] {
    return (
      this.db
        .prepare("SELECT t.* FROM tasks t, json_each(t.depends_on) d WHERE d.value = ?")
        .all(taskId) as Row[]
    ).map(toTask);
  }

  // ── approvals ──
  createApproval(a: Omit<Approval, "id" | "status" | "decidedAt" | "note" | "createdAt">): Approval {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO approvals (id, task_id, agent_id, tool_id, tool_use_id, summary, input, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(id, a.taskId, a.agentId, a.toolId, a.toolUseId, a.summary, json(a.input), now());
    return this.getApproval(id)!;
  }

  getApproval(id: string): Approval | null {
    const r = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Row | undefined;
    return r ? toApproval(r) : null;
  }

  listApprovals(opts: { status?: ApprovalStatus; taskId?: string; limit?: number } = {}): Approval[] {
    const where: string[] = [];
    const vals: (string | number)[] = [];
    if (opts.status) (where.push("status = ?"), vals.push(opts.status));
    if (opts.taskId) (where.push("task_id = ?"), vals.push(opts.taskId));
    vals.push(opts.limit ?? 100);
    return (
      this.db
        .prepare(`SELECT * FROM approvals ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
        .all(...vals) as Row[]
    ).map(toApproval);
  }

  /** Returns null if the approval does not exist or was already decided. */
  decideApproval(id: string, status: "approved" | "rejected", note: string | null): Approval | null {
    const res = this.db
      .prepare("UPDATE approvals SET status = ?, note = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
      .run(status, note, now(), id);
    return Number(res.changes) > 0 ? this.getApproval(id) : null;
  }

  // ── events ──
  addEvent(e: NewEvent): TownEvent {
    const res = this.db
      .prepare("INSERT INTO events (ts, type, agent_id, task_id, message, data, simulated) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(now(), e.type, e.agentId ?? null, e.taskId ?? null, e.message, json(e.data ?? {}), e.simulated ? 1 : 0);
    const event = toEvent(this.db.prepare("SELECT * FROM events WHERE id = ?").get(Number(res.lastInsertRowid)) as Row);
    this.bus.emit("event", event);
    return event;
  }

  listEvents(opts: { sinceId?: number; agentId?: string; taskId?: string; limit?: number } = {}): TownEvent[] {
    const where: string[] = [];
    const vals: (string | number)[] = [];
    if (opts.sinceId !== undefined) (where.push("id > ?"), vals.push(opts.sinceId));
    if (opts.agentId) (where.push("agent_id = ?"), vals.push(opts.agentId));
    if (opts.taskId) (where.push("task_id = ?"), vals.push(opts.taskId));
    vals.push(opts.limit ?? 200);
    const rows = this.db
      .prepare(`SELECT * FROM events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`)
      .all(...vals) as Row[];
    return rows.map(toEvent).reverse();
  }

  // ── usage ──
  recordUsage(u: Omit<UsageRecord, "id" | "ts">): UsageRecord {
    const ts = now();
    const res = this.db
      .prepare(
        `INSERT INTO usage (ts, agent_id, task_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
           web_search_requests, cost_usd, simulated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ts, u.agentId, u.taskId, u.model, u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheWriteTokens,
        u.webSearchRequests, u.costUsd, u.simulated ? 1 : 0,
      );
    return { ...u, id: Number(res.lastInsertRowid), ts };
  }

  /** Estimated spend since `sinceIso` (real API usage only). */
  spendSince(sinceIso: string): number {
    const r = this.db
      .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM usage WHERE ts >= ? AND simulated = 0")
      .get(sinceIso) as Row;
    return Number(r.c);
  }

  usageQuery<T = Row>(sql: string, ...params: (string | number)[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
}
