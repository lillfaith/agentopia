import { randomUUID } from "node:crypto";
import type { Cadence, Schedule, ScheduleTarget, Weekday } from "../../shared/types.js";
import type { Config } from "../config.js";
import { transaction } from "../db/database.js";
import type { Store } from "../db/store.js";
import { budgetStatus } from "./budget.js";
import { startCampaignWorkflow } from "./workflows.js";

// ───────────────────────── time-zone math (no dependencies) ─────────────────────────

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface LocalParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  weekday: Weekday;
}

const WEEKDAYS: Record<string, Weekday> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localParts(date: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: +get("year"), m: +get("month"), d: +get("day"), h: +get("hour"), mi: +get("minute"), weekday: WEEKDAYS[get("weekday")] };
}

/** Offset (ms) of `tz` from UTC at instant `t`. */
function offsetAt(t: number, tz: string): number {
  const p = localParts(new Date(t), tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(t / 60_000) * 60_000;
}

/**
 * UTC instant for a local wall-clock time. Non-existent local times (spring-forward gap)
 * are shifted forward by the gap (02:30 → 03:30); ambiguous times (fall-back) resolve
 * to the earlier occurrence.
 */
export function zonedTimeToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(first, tz);
  const t = Math.min(first, second);
  const back = localParts(new Date(t), tz);
  if (back.h === h && back.mi === mi) return new Date(t);
  const other = Math.max(first, second);
  const back2 = localParts(new Date(other), tz);
  if (back2.h === h && back2.mi === mi) return new Date(other);
  // In a DST gap: use the later candidate (wall time shifted forward by the gap).
  return new Date(other);
}

function parseHHMM(time: string): { h: number; mi: number } {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) throw new Error(`Invalid time "${time}" (expected HH:MM, 24-hour)`);
  return { h: +m[1], mi: +m[2] };
}

/** The first occurrence strictly after `after`. */
export function computeNextRun(cadence: Cadence, tz: string, after: Date): Date {
  if (cadence.kind === "interval") return new Date(after.getTime() + cadence.everyMinutes * 60_000);
  const { h, mi } = parseHHMM(cadence.time);
  const days = cadence.kind === "weekly" ? new Set(cadence.days) : null;
  if (days && days.size === 0) throw new Error("Weekly schedules need at least one day");
  const start = localParts(after, tz);
  // Walk local calendar days (UTC date arithmetic on the local Y/M/D is safe).
  for (let i = 0; i < 9; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const weekday = (((day.getUTCDay() + 6) % 7) + 1) as Weekday;
    if (days && !days.has(weekday)) continue;
    const candidate = zonedTimeToUtc(y, m, d, h, mi, tz);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  throw new Error("Could not compute next run");
}

/** Approximate runs per 30-day month, for cost projections. */
export function runsPerMonth(cadence: Cadence): number {
  if (cadence.kind === "interval") return Math.round((30 * 24 * 60) / cadence.everyMinutes);
  if (cadence.kind === "daily") return 30;
  return Math.round((cadence.days.length * 30) / 7);
}

export function validateCadence(cadence: Cadence, minIntervalMinutes: number): void {
  if (cadence.kind === "interval") {
    if (!Number.isInteger(cadence.everyMinutes) || cadence.everyMinutes < minIntervalMinutes) {
      throw new Error(`Interval must be a whole number of minutes ≥ ${minIntervalMinutes}`);
    }
  } else {
    parseHHMM(cadence.time);
    if (cadence.kind === "weekly" && (!cadence.days.length || cadence.days.some((d) => d < 1 || d > 7))) {
      throw new Error("Weekly schedules need days between 1 (Mon) and 7 (Sun)");
    }
  }
}

export function describeCadence(c: Cadence, tz: string): string {
  if (c.kind === "interval") return c.everyMinutes % 60 === 0 ? `every ${c.everyMinutes / 60}h` : `every ${c.everyMinutes} min`;
  if (c.kind === "daily") return `daily at ${c.time} (${tz})`;
  const names = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return `${[...c.days].sort().map((d) => names[d]).join(", ")} at ${c.time} (${tz})`;
}

// ───────────────────────── scheduler ─────────────────────────

export interface FireResult {
  fired: boolean;
  outcome: string;
  taskId?: string;
  workflowId?: string;
}

/**
 * Turns due schedules into tasks. Runs inside worker processes; the browser is
 * not involved. Each due occurrence is claimed with a compare-and-set on
 * next_run_at, so concurrent workers never double-fire. If the worker was down
 * and several occurrences were missed, the schedule fires ONCE on recovery and
 * then continues from the next future slot.
 */
export class Scheduler {
  constructor(
    private readonly store: Store,
    private readonly config: Config,
    private readonly simulated: boolean,
  ) {}

  tick(now = new Date()): FireResult[] {
    const results: FireResult[] = [];
    for (const s of this.store.dueSchedules(now.toISOString())) {
      let next: string | null;
      try {
        next = computeNextRun(s.cadence, s.timezone, now).toISOString();
      } catch (err) {
        next = null; // broken cadence: stop it rather than spin
        this.store.addEvent({ type: "schedule.skipped", message: `Schedule “${s.name}” disabled: ${String(err)}`, data: { scheduleId: s.id } });
      }
      if (!this.store.advanceSchedule(s.id, s.nextRunAt!, next)) continue; // another worker took it
      results.push(this.fire(s, "schedule"));
    }
    return results;
  }

  /** Fire a schedule now (also used by "Run now"). Does not move next_run_at. */
  fire(s: Schedule, trigger: "schedule" | "manual"): FireResult {
    const skip = (outcome: string): FireResult => {
      this.store.recordScheduleRun(s.id, { outcome, fired: false });
      this.store.addEvent({ type: "schedule.skipped", message: `Skipped “${s.name}”: ${outcome}`, data: { scheduleId: s.id, trigger } });
      return { fired: false, outcome };
    };
    if (s.overlap === "skip" && this.store.scheduleHasActiveRun(s.id)) return skip("previous run still in progress");
    const budget = budgetStatus(this.store, this.config, this.simulated);
    if (budget.globalHold) return skip("budget limit reached");

    try {
      const created = transaction(this.store.db, () => this.createRun(s.id, s.target, trigger));
      const outcome = trigger === "manual" ? "started manually" : "started";
      this.store.recordScheduleRun(s.id, { outcome, fired: true, taskId: created.taskId, workflowId: created.workflowId });
      this.store.addEvent({
        type: "schedule.fired",
        agentId: created.agentId,
        taskId: created.taskId ?? null,
        message: `⏰ ${trigger === "manual" ? "Ran now" : "Scheduled"}: ${s.name}`,
        data: { scheduleId: s.id, workflowId: created.workflowId ?? null, trigger },
      });
      return { fired: true, outcome, taskId: created.taskId, workflowId: created.workflowId };
    } catch (err) {
      return skip(err instanceof Error ? err.message : String(err));
    }
  }

  private createRun(scheduleId: string, target: ScheduleTarget, trigger: string): { taskId?: string; workflowId?: string; agentId: string | null } {
    if (target.type === "task") {
      const agent = this.store.getAgent(target.agentId);
      if (!agent || agent.archived || !agent.enabled) throw new Error(`agent “${target.agentId}” is not available`);
      const task = this.store.createTask({
        title: target.title,
        instructions: target.instructions,
        agentId: agent.id,
        priority: target.priority,
        createdBy: `schedule:${scheduleId}`,
        scheduleId,
      });
      this.store.addEvent({
        type: "task.created",
        agentId: agent.id,
        taskId: task.id,
        message: `Schedule assigned “${task.title}” to ${agent.name}`,
        data: { scheduleId, trigger },
      });
      return { taskId: task.id, agentId: agent.id };
    }
    const wf = startCampaignWorkflow(this.store, { topic: target.topic, audience: target.audience, goal: target.goal }, undefined, scheduleId);
    return { workflowId: wf.id, agentId: null };
  }
}

export function newScheduleId(): string {
  return randomUUID();
}
