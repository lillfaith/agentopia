import path from "node:path";
import type { Config } from "../config.js";
import { log } from "../log.js";
import { createApp } from "../app.js";
import type { TownEvent } from "../../shared/types.js";
import type { LLMProvider } from "../llm/provider.js";
import type { ConcurrencyGate } from "../engine/runner.js";
import type { AccountsStore } from "./accounts.js";
import { entitlementsFor, type Entitlements } from "./plans.js";

const TOWN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Queued work that can't start yet (a budget hold) is looked at again after this long. */
const HELD_RECHECK_MS = 15 * 60_000;

export interface TownHandle {
  id: string;
  ownerId: string;
  /** This town's own config object; plan changes update it in place. */
  config: Config;
  app: ReturnType<typeof createApp>;
  lastUsed: number;
  /** Event listeners the registry itself attached (anything beyond these is a live stream). */
  ownListeners: number;
}

export interface TownsOptions {
  /** How often the pool looks for towns with due work and for idle towns to close. */
  pollMs?: number;
  /** A town nobody has used for this long, with nothing running, is closed. */
  idleMs?: number;
  /** Keep a town open this long after a task starts or settles (status animations still write to it). */
  activityGraceMs?: number;
  /** Start each town's worker when it opens (false in tests that drive runners by hand). */
  runWorkers?: boolean;
  timings?: { retryBaseMs?: number; statusDecayMs?: number };
}

class Semaphore implements ConcurrencyGate {
  private used = 0;
  constructor(readonly size: number) {}
  get inUse(): number {
    return this.used;
  }
  tryAcquire(): boolean {
    if (this.used >= this.size) return false;
    this.used += 1;
    return true;
  }
  release(): void {
    this.used = Math.max(0, this.used - 1);
  }
}

/**
 * Every user's private town is its own SQLite file running the unchanged
 * single-town engine (Store, API routes, TaskRunner). This registry opens towns
 * on demand, keeps their workers running while they have work or visitors, and
 * closes idle ones after recording when they next need attention (`wake_at` in
 * the accounts database). A background loop reopens towns whose wake time has
 * come, so scheduled and retried work runs with no browser open.
 */
export class Towns {
  private readonly open = new Map<string, TownHandle>();
  private readonly gate: Semaphore;
  private timer: NodeJS.Timeout | null = null;
  private readonly pollMs: number;
  private readonly idleMs: number;
  private readonly graceMs: number;
  private readonly entitlementCache = new Map<string, { at: number; value: Entitlements }>();

  constructor(
    private readonly base: Config,
    private readonly accounts: AccountsStore,
    private readonly provider: LLMProvider,
    private readonly opts: TownsOptions = {},
  ) {
    this.gate = new Semaphore(base.globalConcurrency);
    this.pollMs = opts.pollMs ?? 2_000;
    this.idleMs = opts.idleMs ?? 10 * 60_000;
    this.graceMs = opts.activityGraceMs ?? 30_000;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  get openCount(): number {
    return this.open.size;
  }

  get activeTasks(): number {
    return this.gate.inUse;
  }

  isOpen(townId: string): boolean {
    return this.open.has(townId);
  }

  townPath(townId: string): string {
    if (!TOWN_ID.test(townId)) throw new Error("Invalid town id");
    return path.join(this.base.dataDir, "towns", `${townId}.sqlite`);
  }

  /** Server-side entitlements for a town's owner (cached briefly; the worker asks on every tick). */
  entitlements(ownerId: string, fresh = false): Entitlements {
    const hit = this.entitlementCache.get(ownerId);
    if (!fresh && hit && Date.now() - hit.at < 30_000) return hit.value;
    const account = this.accounts.getUser(ownerId);
    const value = entitlementsFor(account ?? { plan: "trial", trialEndsAt: new Date(0).toISOString() });
    if (!account || account.status !== "active") Object.assign(value, { canRun: false, reason: "This account is suspended." });
    this.entitlementCache.set(ownerId, { at: Date.now(), value });
    return value;
  }

  private townConfig(townId: string, ent: Entitlements): Config {
    return {
      ...this.base,
      dbPath: this.townPath(townId),
      defaultModel: ent.plan.defaultModel,
      dailyBudgetUsd: ent.plan.dailyUsd,
      monthlyBudgetUsd: ent.plan.monthlyUsd,
      maxTaskCostUsd: ent.plan.perTaskUsd,
      workerConcurrency: ent.plan.concurrency,
      allowedModels: ent.plan.models,
      role: "all",
    };
  }

  /** Open (or reuse) a town and make sure its worker is running. */
  get(townId: string): TownHandle {
    const existing = this.open.get(townId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing;
    }
    const ownerId = this.accounts.ownerOf(townId);
    if (!ownerId) throw new Error("Unknown town");
    const config = this.townConfig(townId, this.entitlements(ownerId, true));
    const app = createApp(config, {
      provider: this.provider,
      startWorker: false,
      embedded: true,
      timings: this.opts.timings,
      runner: {
        gate: this.gate,
        hold: () => {
          const ent = this.entitlements(ownerId);
          if (!ent.canRun) return ent.reason;
          return this.globalHold();
        },
      },
    });
    // Mirror every model call's cost into the accounts database (operator cap, per-user cost reporting).
    // Calls on the owner's own API key cost the operator nothing and are left out.
    app.store.bus.on("event", (e: TownEvent) => {
      if (e.type !== "usage.recorded" || e.simulated || e.data.billing === "own") return;
      const cost = Number(e.data.costUsd ?? 0);
      if (cost > 0) this.accounts.addUsage(ownerId, cost);
    });
    const handle: TownHandle = { id: townId, ownerId, config, app, lastUsed: Date.now(), ownListeners: app.store.bus.listenerCount("event") };
    this.open.set(townId, handle);
    // Until this town is closed cleanly, a crash must bring it back on the next boot.
    this.accounts.setWake(townId, new Date().toISOString());
    if (this.opts.runWorkers !== false) app.runner.start();
    return handle;
  }

  /** Something changed in this town (a new task, an approval…): look for work now. */
  wake(townId: string): void {
    this.get(townId).app.runner.poke();
  }

  private globalCache = { at: 0, reason: null as string | null };

  /** Operator-wide daily spend ceiling across every user (AGENTOPIA_GLOBAL_DAILY_BUDGET_USD). */
  globalHold(): string | null {
    const cap = this.base.globalDailyBudgetUsd;
    if (!cap) return null;
    if (Date.now() - this.globalCache.at < 10_000) return this.globalCache.reason;
    const spent = this.accounts.spendOn(new Date().toISOString().slice(0, 10));
    const reason = spent >= cap ? "Agentopia is at its daily capacity. Queued work will resume automatically tomorrow (UTC)." : null;
    this.globalCache = { at: Date.now(), reason };
    return reason;
  }

  /** Re-read the owner's plan and apply its limits to an open town. */
  refreshEntitlements(ownerId: string): void {
    const ent = this.entitlements(ownerId, true);
    for (const h of this.open.values()) {
      if (h.ownerId !== ownerId) continue;
      const next = this.townConfig(h.id, ent);
      Object.assign(h.config, {
        defaultModel: next.defaultModel,
        dailyBudgetUsd: next.dailyBudgetUsd,
        monthlyBudgetUsd: next.monthlyBudgetUsd,
        maxTaskCostUsd: next.maxTaskCostUsd,
        workerConcurrency: next.workerConcurrency,
        allowedModels: next.allowedModels,
      });
      h.app.runner.poke();
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.loop(), this.pollMs);
    this.loop();
  }

  /** Open towns whose wake time has come; close idle ones. Exposed for tests. */
  loop(): void {
    try {
      for (const id of this.accounts.dueTowns(new Date().toISOString())) {
        if (this.open.has(id)) continue;
        const h = this.get(id);
        // Opened by the worker, not a visitor: close soon after its work is done.
        h.lastUsed = Date.now() - this.idleMs + Math.min(this.idleMs, 60_000);
      }
      const now = Date.now();
      for (const h of [...this.open.values()]) {
        if (now - h.lastUsed < this.idleMs) continue;
        if (h.app.runner.activeCount > 0 || now - h.app.runner.lastActivityAt < this.graceMs || h.app.runner.hasClaimableWork()) continue;
        if (h.app.store.bus.listenerCount("event") > h.ownListeners) continue; // a live event stream is attached
        this.close(h);
      }
    } catch (err) {
      log.error("Town pool loop failed", err, { scope: "towns" });
    }
  }

  /** When this town next needs a worker, or null if never (until someone changes something). */
  private nextWake(h: TownHandle): string | null {
    const { pendingAt, scheduleAt } = h.app.store.nextWakeHint();
    const nowIso = new Date().toISOString();
    let pending = pendingAt;
    // Due but not claimable (budget hold, plan lapsed): check again later rather than spin.
    if (pending && pending <= nowIso && !h.app.runner.hasClaimableWork()) pending = new Date(Date.now() + HELD_RECHECK_MS).toISOString();
    const candidates = [pending, scheduleAt].filter((x): x is string => !!x).sort();
    return candidates[0] ?? null;
  }

  private close(h: TownHandle): void {
    this.open.delete(h.id);
    const wake = h.app.runner.activeCount > 0 ? new Date().toISOString() : this.nextWake(h);
    void h.app.runner.stop();
    h.app.db.close();
    this.accounts.setWake(h.id, wake);
  }

  /** Graceful shutdown: running tasks go back to the queue and resume on the next boot. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const h of [...this.open.values()]) {
      this.open.delete(h.id);
      const wake = h.app.runner.activeCount > 0 ? new Date().toISOString() : this.nextWake(h);
      await h.app.runner.stop();
      h.app.db.close();
      this.accounts.setWake(h.id, wake);
    }
  }
}
