import { randomUUID } from "node:crypto";
import type { Task } from "../../shared/types.js";
import type { Config } from "../config.js";
import type { Store } from "../db/store.js";
import type { LLMProvider } from "../llm/provider.js";
import { AgentExecutor } from "./executor.js";

const LEASE_MS = 60_000;
const RETRY_BASE_MS = 5_000;
const STATUS_DECAY_MS = 6_000;

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

  private readonly retryBaseMs: number;
  private readonly statusDecayMs: number;

  constructor(
    private readonly store: Store,
    readonly provider: LLMProvider,
    private readonly config: Config,
    timings: { retryBaseMs?: number; statusDecayMs?: number } = {},
  ) {
    this.executor = new AgentExecutor(store, provider, config);
    this.retryBaseMs = timings.retryBaseMs ?? RETRY_BASE_MS;
    this.statusDecayMs = timings.statusDecayMs ?? STATUS_DECAY_MS;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  get activeCount(): number {
    return this.active.size;
  }

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    this.recover();
    this.timer = setInterval(() => void this.tick(), this.config.workerPollMs);
    void this.tick();
  }

  /** Graceful stop: in-flight tasks go back to the queue and resume (append-only) on next start. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopping = true;
    for (const [taskId, c] of this.active) {
      c.abort();
      this.store.updateTask(taskId, { status: "queued", releaseLease: true });
    }
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

  /** Claim and start as many tasks as concurrency allows. Exposed for tests. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.store.requeueExpiredLeases();
      while (this.active.size < this.config.workerConcurrency) {
        const task = this.store.claimNextTask(this.workerId, LEASE_MS);
        if (!task) break;
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
      if (this.active.size === 0 && !this.store.claimNextTaskPreview()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("drain timed out");
  }

  private async run(task: Task): Promise<void> {
    const controller = new AbortController();
    this.active.set(task.id, controller);
    const sim = this.provider.simulated;
    if (sim && !task.simulated) this.store.updateTask(task.id, { simulated: true });
    const heartbeat = setInterval(() => this.store.renewLease(task.id, this.workerId, LEASE_MS), LEASE_MS / 3);
    this.store.addEvent({
      type: "task.started",
      agentId: task.agentId,
      taskId: task.id,
      message: task.attempts > 1 ? `Retrying “${task.title}” (attempt ${task.attempts}/${task.maxAttempts})` : `Started: ${task.title}`,
      data: { attempt: task.attempts },
      simulated: sim,
    });
    this.store.setAgentStatus(task.agentId, "planning", `Reading the brief: “${task.title}”`, task.id, sim);

    try {
      const outcome = await this.executor.execute(task, controller.signal);
      const current = this.store.getTask(task.id);
      if (this.stopping || !current || current.status !== "running") return; // cancelled or shutting down

      if (outcome.kind === "completed") {
        this.store.updateTask(task.id, { status: "completed", output: outcome.output, completedAt: new Date().toISOString(), lastError: null, releaseLease: true });
        this.store.addEvent({ type: "task.completed", agentId: task.agentId, taskId: task.id, message: `Finished: ${task.title}`, simulated: sim });
        this.flashStatus(task.agentId, task.id, "completed", `Done: ${task.title}`);
        this.onCompleted(task);
      } else if (outcome.kind === "waiting_approval") {
        this.store.updateTask(task.id, { status: "waiting_approval", releaseLease: true });
        this.store.setAgentStatus(task.agentId, "waiting_approval", "Waiting for your approval", task.id, sim);
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
      const a = this.store.getAgent(agentId);
      if (a && a.currentTaskId === taskId && a.status === status) this.store.setAgentStatus(agentId, "idle", null, null, this.provider.simulated);
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
