import { randomUUID } from "node:crypto";
import os from "node:os";
import type { Task } from "../../shared/types.js";
import type { ProviderResolver } from "../llm/keys.js";
import type { Config } from "../config.js";
import type { Store } from "../db/store.js";
import type { LLMProvider } from "../llm/provider.js";
import { budgetStatus } from "./budget.js";
import { AgentExecutor } from "./executor.js";
import { rewardTask } from "./rewards.js";
import { Scheduler } from "./scheduler.js";

/** A crashed worker's tasks are recovered at most this long after its last heartbeat. */
const LEASE_MS = 30_000;
const RETRY_BASE_MS = 5_000;
const STATUS_DECAY_MS = 6_000;
const WORKER_HEARTBEAT_MS = 5_000;

/** Process-wide cap on concurrent tasks, shared by every town's runner (SaaS mode). */
export interface ConcurrencyGate {
  tryAcquire(): boolean;
  release(): void;
}

export interface RunnerOptions {
  retryBaseMs?: number;
  statusDecayMs?: number;
  gate?: ConcurrencyGate;
  /** When this returns a reason, nothing new starts (e.g. a lapsed plan). */
  hold?: () => string | null;
  /** Picks each villager's provider (owners' own keys). Without it every villager uses `provider`. */
  resolver?: ProviderResolver;
}

/**
 * Durable background worker. The queue lives in the database, so tasks keep
 * running whether or not any browser is open, and a crashed worker's tasks are
 * re-queued when their lease expires. Several workers (processes) can share one
 * database file; claims are serialised with BEGIN IMMEDIATE.
 */
export class TaskRunner {
  readonly workerId = `worker-${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  private readonly active = new Map<string, AbortController>();
  private readonly executor: AgentExecutor;
  private ticking = false;
  private stopping = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly startedAt = new Date().toISOString();
  private lastHoldNotice = "";
  readonly scheduler: Scheduler;

  private readonly retryBaseMs: number;
  private readonly statusDecayMs: number;
  private readonly gate: ConcurrencyGate | undefined;
  private readonly hold: (() => string | null) | undefined;

  constructor(
    private readonly store: Store,
    readonly provider: LLMProvider,
    private readonly config: Config,
    opts: RunnerOptions = {},
  ) {
    this.executor = new AgentExecutor(store, provider, config, opts.resolver);
    this.scheduler = new Scheduler(store, config, provider.simulated);
    this.retryBaseMs = opts.retryBaseMs ?? RETRY_BASE_MS;
    this.statusDecayMs = opts.statusDecayMs ?? STATUS_DECAY_MS;
    this.gate = opts.gate;
    this.hold = opts.hold;
  }

  /** Why new model calls can't start right now (lapsed plan, operator cap), or null. */
  holdReason(): string | null {
    return this.hold?.() ?? null;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  get activeCount(): number {
    return this.active.size;
  }

  /** When a task last started or settled here (ms since epoch). */
  lastActivityAt = 0;

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    this.recover();
    this.heartbeat();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), WORKER_HEARTBEAT_MS);
    this.timer = setInterval(() => void this.tick(), this.config.workerPollMs);
    void this.tick();
  }

  /** Register liveness so the API (possibly another process) can show worker health. */
  private heartbeat(): void {
    try {
      this.store.heartbeatWorker({
        id: this.workerId,
        role: this.config.role === "worker" ? "worker" : "all",
        hostname: os.hostname(),
        pid: process.pid,
        startedAt: this.startedAt,
        activeTasks: this.active.size,
      });
    } catch (err) {
      console.error("[worker] heartbeat failed", err);
    }
  }

  /** Graceful stop: in-flight tasks go back to the queue and resume (append-only) on next start. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.timer = null;
    this.heartbeatTimer = null;
    this.stopping = true;
    for (const [taskId, c] of this.active) {
      c.abort();
      const t = this.store.getTask(taskId);
      // An interrupted attempt is not a failed one: give it back.
      this.store.updateTask(taskId, { status: "queued", releaseLease: true, attempts: Math.max(0, (t?.attempts ?? 1) - 1) });
    }
    this.store.removeWorker(this.workerId);
  }

  /** Crash recovery on boot: expired leases go back to the queue, stale agent states reset. */
  recover(): void {
    for (const t of this.store.requeueExpiredLeases()) {
      this.store.addEvent({ type: "system.notice", taskId: t.id, agentId: t.agentId, message: `Recovered interrupted task “${t.title}” — re-queued.` });
    }
    for (const a of this.store.listAgents()) {
      const t = a.currentTaskId ? this.store.getTask(a.currentTaskId) : null;
      if (a.status !== "idle" && (!t || t.status !== "running")) {
        const waiting = t?.status === "waiting_approval";
        this.store.setAgentStatus(a.id, waiting ? "waiting_approval" : "idle", waiting ? "Waiting for your approval" : null, waiting ? t!.id : null);
      }
    }
  }

  /** Ask a started worker to look for work now (no-op in API-only processes). */
  poke(): void {
    if (this.timer) void this.tick();
  }

  /** Claim and start as many tasks as concurrency allows. Exposed for tests. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const t of this.store.requeueExpiredLeases()) {
        this.store.addEvent({ type: "system.notice", taskId: t.id, agentId: t.agentId, message: `Recovered “${t.title}” from a worker that stopped responding — re-queued.` });
      }
      if (this.hold?.() || this.store.getSettings().paused) return;
      try {
        this.scheduler.tick();
      } catch (err) {
        console.error("[scheduler]", err);
      }
      // Strict budgets: when a town cap is reached, villagers on Agentopia's key wait (villagers on
      // the owner's own key keep working: that spend is theirs); capped villagers are skipped.
      const budget = budgetStatus(this.store, this.config, this.provider.simulated);
      const held = this.heldAgents(budget);
      if (budget.globalHold) {
        const key = budget.resetsAt.day.slice(0, 10);
        if (this.lastHoldNotice !== key && this.store.claimNextTaskPreview(this.ownKeyAgents())) {
          this.lastHoldNotice = key;
          this.store.addEvent({ type: "budget.hold", message: "Budget limit reached — queued work is paused until the limit resets or is raised.", data: { budget } });
        }
      }
      while (this.active.size < this.config.workerConcurrency) {
        if (this.gate && !this.gate.tryAcquire()) break;
        const task = this.store.claimNextTask(this.workerId, LEASE_MS, held);
        if (!task) {
          this.gate?.release();
          break;
        }
        void this.run(task);
      }
    } finally {
      this.ticking = false;
    }
  }

  /** Resolves once every in-flight task has settled. Useful for tests and shutdown. */
  async drain(timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await this.tick();
      if (this.active.size === 0 && !this.hasClaimableWork()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("drain timed out");
  }

  /** Is there work this worker could start right now (respecting budget holds)? */
  hasClaimableWork(): boolean {
    if (this.hold?.() || this.store.getSettings().paused) return false;
    const budget = budgetStatus(this.store, this.config, this.provider.simulated);
    return this.store.claimNextTaskPreview(this.heldAgents(budget));
  }

  /** Villagers that can't start work now: over their own cap, or on Agentopia's key while the town is held. */
  private heldAgents(budget: ReturnType<typeof budgetStatus>): string[] {
    if (!budget.globalHold) return budget.agentHolds;
    const platformAgents = this.store.listAgents().filter((a) => !a.credentialId).map((a) => a.id);
    return [...new Set([...budget.agentHolds, ...platformAgents])];
  }

  private ownKeyAgents(): string[] {
    return this.store.listAgents().filter((a) => a.credentialId).map((a) => a.id);
  }

  private async run(task: Task): Promise<void> {
    const controller = new AbortController();
    this.active.set(task.id, controller);
    this.lastActivityAt = Date.now();
    const sim = this.provider.simulated;
    // Label the task by how THIS attempt runs (a task re-run live after a simulated run becomes live).
    if (task.simulated !== sim) this.store.updateTask(task.id, { simulated: sim });
    // Lease heartbeat; also notices a cancel issued by another process (e.g. a separate API server).
    const heartbeat = setInterval(() => {
      this.store.renewLease(task.id, this.workerId, LEASE_MS);
      if (this.store.getTask(task.id)?.status === "cancelled") controller.abort();
    }, Math.min(LEASE_MS / 3, 2_000));
    this.store.addEvent({
      type: "task.started",
      agentId: task.agentId,
      taskId: task.id,
      message:
        task.attempts > 1
          ? `Retrying “${task.title}” (attempt ${task.attempts}/${task.maxAttempts})`
          : this.store.unreadOwnerMessages(task.id).length
            ? `Reading your message: ${task.title}`
            : `Started: ${task.title}`,
      data: { attempt: task.attempts },
      simulated: sim,
    });
    this.store.setAgentStatus(task.agentId, "planning", `Reading the brief: “${task.title}”`, task.id, sim);

    try {
      const outcome = await this.executor.execute(task, controller.signal);
      const current = this.store.getTask(task.id);
      if (this.stopping || !current || current.status !== "running") return; // cancelled or shutting down

      if (outcome.kind === "completed") {
        this.store.materializeTaskMessages(task.id); // tasks from before conversations were stored
        this.store.updateTask(task.id, { status: "completed", output: outcome.output, completedAt: new Date().toISOString(), lastError: null, releaseLease: true });
        this.store.addTaskMessage(task.id, "agent", outcome.output);
        const replied = this.store.listTaskMessages(task.id).some((m) => m.role === "owner");
        const who = this.store.getAgent(task.agentId)?.name ?? "The villager";
        this.store.addEvent({
          type: "task.completed",
          agentId: task.agentId,
          taskId: task.id,
          message: replied || task.kind === "chat" ? `${who} replied: ${task.title}` : `Finished: ${task.title}`,
          simulated: sim,
        });
        this.flashStatus(task.agentId, task.id, "completed", `Done: ${task.title}`);
        this.onCompleted(task);
        try {
          rewardTask(this.store, task.id, sim);
        } catch (err) {
          console.error("[rewards]", err); // never let a reward problem affect the task itself
        }
      } else if (outcome.kind === "waiting_approval") {
        this.store.updateTask(task.id, { status: "waiting_approval", releaseLease: true });
        this.store.setAgentStatus(task.agentId, "waiting_approval", "Waiting for your approval", task.id, sim);
      } else if (outcome.kind === "budget_hold") {
        // Not a failure: give the attempt back and wait for the budget window to reset.
        this.store.updateTask(task.id, { status: "queued", runAfter: outcome.resumeAt, attempts: Math.max(0, task.attempts - 1), releaseLease: true });
        this.store.addEvent({ type: "budget.hold", agentId: task.agentId, taskId: task.id, message: `Paused “${task.title}”: ${outcome.message}`, data: { resumeAt: outcome.resumeAt } });
        this.store.setAgentStatus(task.agentId, "idle", null, null, sim);
      } else {
        this.handleFailure(current, outcome.error, outcome.retryable);
      }
    } catch (err) {
      // Executor bugs should still leave the task in a consistent state.
      const latest = this.store.getTask(task.id);
      if (latest) this.handleFailure(latest, err instanceof Error ? err.message : String(err), true);
    } finally {
      clearInterval(heartbeat);
      this.active.delete(task.id);
      this.lastActivityAt = Date.now();
      this.gate?.release();
      if (this.timer) void this.tick();
    }
  }

  private handleFailure(task: Task, error: string, retryable: boolean): void {
    const sim = this.provider.simulated;
    if (retryable && task.attempts < task.maxAttempts) {
      const delay = this.retryBaseMs * 2 ** (task.attempts - 1);
      const runAfter = new Date(Date.now() + delay).toISOString();
      this.store.updateTask(task.id, { status: "retry_wait", lastError: error, runAfter, releaseLease: true });
      this.store.addEvent({
        type: "task.retry_scheduled",
        agentId: task.agentId,
        taskId: task.id,
        message: `Attempt ${task.attempts} failed (${error}). Retrying in ${Math.max(1, Math.round(delay / 1000))}s.`,
        data: { error, runAfter },
        simulated: sim,
      });
      this.store.setAgentStatus(task.agentId, "idle", null, null, sim);
      return;
    }
    this.store.updateTask(task.id, { status: "failed", lastError: error, completedAt: new Date().toISOString(), releaseLease: true });
    this.store.addEvent({ type: "task.failed", agentId: task.agentId, taskId: task.id, message: `Failed: ${task.title} — ${error}`, data: { error }, simulated: sim });
    this.flashStatus(task.agentId, task.id, "failed", error);
    this.cascade(task, "failed", `Dependency “${task.title}” failed`);
  }

  /** Unblock dependents whose dependencies are now all complete, and close workflows. */
  private onCompleted(task: Task): void {
    const sim = this.provider.simulated;
    for (const dep of this.store.dependentsOf(task.id)) {
      if (dep.status !== "blocked") continue;
      const ready = dep.dependsOn.every((id) => this.store.getTask(id)?.status === "completed");
      if (!ready) continue;
      this.store.updateTask(dep.id, { status: "queued" });
      this.store.addEvent({ type: "task.unblocked", agentId: dep.agentId, taskId: dep.id, message: `Ready: ${dep.title}`, simulated: sim });
      if (dep.agentId !== task.agentId) {
        const from = this.store.getAgent(task.agentId);
        const to = this.store.getAgent(dep.agentId);
        this.store.addEvent({
          type: "task.handoff",
          agentId: task.agentId,
          taskId: dep.id,
          message: `Sent “${task.title}” → ${to?.name ?? dep.agentId}`,
          data: { fromAgentId: task.agentId, toAgentId: dep.agentId, kind: "deliverable", fromName: from?.name },
          simulated: sim,
        });
      }
    }
    if (task.workflowId) {
      const wf = this.store.getWorkflow(task.workflowId);
      if (wf && wf.status === "running" && wf.finalTaskId === task.id) {
        this.store.setWorkflowStatus(wf.id, "completed");
        this.store.addEvent({
          type: "workflow.completed",
          agentId: task.agentId,
          taskId: task.id,
          message: `Deliverable ready: ${wf.title}`,
          data: { workflowId: wf.id },
          simulated: sim,
        });
      }
    }
  }

  /** Propagate failure/cancellation down the dependency graph. */
  private cascade(task: Task, status: "failed" | "cancelled", reason: string): void {
    for (const dep of this.store.dependentsOf(task.id)) {
      if (dep.status !== "blocked" && dep.status !== "queued") continue;
      this.store.updateTask(dep.id, { status, lastError: reason, completedAt: new Date().toISOString() });
      this.store.addEvent({
        type: status === "failed" ? "task.failed" : "task.cancelled",
        agentId: dep.agentId,
        taskId: dep.id,
        message: `${status === "failed" ? "Failed" : "Cancelled"}: ${dep.title} — ${reason}`,
        simulated: this.provider.simulated,
      });
      this.cascade(dep, status, reason);
    }
    if (task.workflowId) {
      const wf = this.store.getWorkflow(task.workflowId);
      if (wf?.status === "running") this.store.setWorkflowStatus(wf.id, status);
    }
  }

  /** Show a transient completed/failed state, then return to idle unless the agent moved on. */
  private flashStatus(agentId: string, taskId: string, status: "completed" | "failed", detail: string): void {
    this.store.setAgentStatus(agentId, status, detail.slice(0, 200), taskId, this.provider.simulated);
    setTimeout(() => {
      try {
        const a = this.store.getAgent(agentId);
        if (a && a.currentTaskId === taskId && a.status === status) this.store.setAgentStatus(agentId, "idle", null, null, this.provider.simulated);
      } catch {
        /* the town was closed in the meantime; recover() resets stale states on reopen */
      }
    }, this.statusDecayMs).unref();
  }

  // ───────────── commands (called from the API) ─────────────

  /** Record a human decision; resume the task once every approval it waits on is decided. */
  decideApproval(approvalId: string, approve: boolean, note: string | null): { ok: boolean; error?: string } {
    const decided = this.store.decideApproval(approvalId, approve ? "approved" : "rejected", note);
    if (!decided) return { ok: false, error: "Approval not found or already decided" };
    this.store.addEvent({
      type: "task.approval_resolved",
      agentId: decided.agentId,
      taskId: decided.taskId,
      message: `${approve ? "Approved" : "Rejected"}: ${decided.summary}${note ? ` — “${note}”` : ""}`,
      data: { approvalId, approved: approve },
      simulated: this.provider.simulated,
    });
    const task = this.store.getTask(decided.taskId);
    const stillPending = this.store.listApprovals({ taskId: decided.taskId, status: "pending" }).length > 0;
    if (task?.status === "waiting_approval" && !stillPending) {
      this.store.updateTask(task.id, { status: "queued" });
      this.store.setAgentStatus(task.agentId, "idle", null, null, this.provider.simulated);
      if (this.timer) void this.tick();
    }
    return { ok: true };
  }

  cancelTask(taskId: string): { ok: boolean; error?: string } {
    const task = this.store.getTask(taskId);
    if (!task) return { ok: false, error: "Task not found" };
    if (["completed", "failed", "cancelled"].includes(task.status)) return { ok: false, error: `Task is already ${task.status}` };
    this.active.get(taskId)?.abort();
    this.store.updateTask(taskId, { status: "cancelled", lastError: "Cancelled by user", completedAt: new Date().toISOString(), releaseLease: true });
    for (const a of this.store.listApprovals({ taskId, status: "pending" })) this.store.decideApproval(a.id, "rejected", "Task cancelled");
    this.store.addEvent({ type: "task.cancelled", agentId: task.agentId, taskId, message: `Cancelled: ${task.title}`, simulated: this.provider.simulated });
    const agent = this.store.getAgent(task.agentId);
    if (agent?.currentTaskId === taskId) this.store.setAgentStatus(task.agentId, "idle", null, null, this.provider.simulated);
    this.cascade(task, "cancelled", `Dependency “${task.title}” was cancelled`);
    return { ok: true };
  }

  /** Emergency stop: nothing new starts, schedules stop firing, and running tasks are cancelled. */
  emergencyStop(): { cancelled: number } {
    this.store.updateSettings({ paused: true });
    let cancelled = 0;
    for (const t of this.store.listTasks({ limit: 1000 })) {
      if (t.status === "running" && this.cancelTask(t.id).ok) cancelled += 1;
    }
    this.store.addEvent({ type: "system.notice", message: `🛑 Emergency stop: all villagers paused${cancelled ? `, ${cancelled} running task(s) cancelled` : ""}. Queued work waits until you resume.`, data: { paused: true, cancelled } });
    return { cancelled };
  }

  resume(): void {
    this.store.updateSettings({ paused: false });
    this.store.addEvent({ type: "system.notice", message: "▶️ Resumed: villagers are back to work.", data: { paused: false } });
    if (this.timer) void this.tick();
  }

  /**
   * The owner replies to a finished task or chat. The villager picks the conversation up where
   * it left off (same transcript, same findings) and answers; its answer becomes the new result.
   */
  sendMessage(taskId: string, text: string): { ok: true; task: Task } | { ok: false; error: string; status: number } {
    const task = this.store.getTask(taskId);
    if (!task) return { ok: false, error: "Task not found", status: 404 };
    const agent = this.store.getAgent(task.agentId);
    if (!agent || agent.archived) return { ok: false, error: "This villager has moved out", status: 409 };
    if (!["completed", "failed", "cancelled"].includes(task.status)) {
      return { ok: false, error: `${agent.name} is still working on this. You can reply once they've answered.`, status: 409 };
    }
    this.store.materializeTaskMessages(taskId);
    this.store.addTaskMessage(taskId, "owner", text, false);
    const updated = this.store.updateTask(taskId, { status: "queued", attempts: 0, lastError: null, completedAt: null, runAfter: null });
    this.store.addEvent({
      type: "task.message",
      agentId: task.agentId,
      taskId,
      message: `You → ${agent.name}: ${text.length > 140 ? text.slice(0, 139) + "…" : text}`,
    });
    if (this.timer) void this.tick();
    return { ok: true, task: updated };
  }

  /** Manually re-run a failed or cancelled task from scratch. */
  retryTask(taskId: string): { ok: boolean; error?: string } {
    const task = this.store.getTask(taskId);
    if (!task) return { ok: false, error: "Task not found" };
    if (task.status !== "failed" && task.status !== "cancelled") return { ok: false, error: "Only failed or cancelled tasks can be retried" };
    const blocked = task.dependsOn.some((id) => this.store.getTask(id)?.status !== "completed");
    this.store.saveConversation(taskId, null);
    this.store.updateTask(taskId, { status: blocked ? "blocked" : "queued", attempts: 0, lastError: null, completedAt: null, runAfter: null });
    if (task.workflowId) this.store.setWorkflowStatus(task.workflowId, "running");
    this.store.addEvent({ type: "task.created", agentId: task.agentId, taskId, message: `Re-queued: ${task.title}` });
    if (this.timer) void this.tick();
    return { ok: true };
  }
}
