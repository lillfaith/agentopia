import { describe, expect, it } from "vitest";
import type { Schedule } from "../shared/types.js";
import { computeNextRun, localParts, runsPerMonth, Scheduler, validateCadence, zonedTimeToUtc } from "../server/engine/scheduler.js";
import { harness, say, ScriptedProvider } from "./helpers.js";

const LA = "America/Los_Angeles";

describe("schedule time math (DST-safe, dependency-free)", () => {
  it("fires daily at the same local wall-clock time across DST changes", () => {
    // US DST starts 2026-03-08 and ends 2026-11-01.
    const beforeSpring = computeNextRun({ kind: "daily", time: "09:00" }, LA, new Date("2026-03-07T18:00:00Z"));
    expect(beforeSpring.toISOString()).toBe("2026-03-08T16:00:00.000Z"); // 09:00 PDT (UTC-7)
    const beforeFall = computeNextRun({ kind: "daily", time: "09:00" }, LA, new Date("2026-10-31T17:00:00Z"));
    expect(beforeFall.toISOString()).toBe("2026-11-01T17:00:00.000Z"); // 09:00 PST (UTC-8)
    for (const d of [beforeSpring, beforeFall]) expect(localParts(d, LA)).toMatchObject({ h: 9, mi: 0 });
  });

  it("handles the spring-forward gap and the fall-back overlap", () => {
    // 02:30 does not exist on 2026-03-08 in LA → shifted forward to 03:30 PDT.
    expect(zonedTimeToUtc(2026, 3, 8, 2, 30, LA).toISOString()).toBe("2026-03-08T10:30:00.000Z");
    // 01:30 happens twice on 2026-11-01 → the earlier (PDT) occurrence.
    expect(zonedTimeToUtc(2026, 11, 1, 1, 30, LA).toISOString()).toBe("2026-11-01T08:30:00.000Z");
  });

  it("supports weekly days, intervals, and strictly-after semantics", () => {
    // 2026-10-08 is a Thursday. Next Mon/Wed 08:15 in London (BST, UTC+1) → Mon 12 Oct.
    const weekly = computeNextRun({ kind: "weekly", days: [1, 3], time: "08:15" }, "Europe/London", new Date("2026-10-08T12:00:00Z"));
    expect(weekly.toISOString()).toBe("2026-10-12T07:15:00.000Z");
    const exact = new Date("2026-10-12T07:15:00Z");
    expect(computeNextRun({ kind: "weekly", days: [1, 3], time: "08:15" }, "Europe/London", exact).toISOString()).toBe("2026-10-14T07:15:00.000Z");
    expect(computeNextRun({ kind: "interval", everyMinutes: 90 }, "UTC", new Date("2026-10-08T00:00:00Z")).toISOString()).toBe("2026-10-08T01:30:00.000Z");
    expect(runsPerMonth({ kind: "weekly", days: [1, 2, 3, 4, 5], time: "09:00" })).toBe(21);
  });

  it("validates cadences, including the minimum interval", () => {
    expect(() => validateCadence({ kind: "interval", everyMinutes: 5 }, 15)).toThrow(/≥ 15/);
    expect(() => validateCadence({ kind: "daily", time: "25:00" }, 15)).toThrow(/HH:MM/);
    expect(() => validateCadence({ kind: "weekly", days: [], time: "09:00" }, 15)).toThrow(/day/);
    expect(() => validateCadence({ kind: "daily", time: "07:05" }, 15)).not.toThrow();
  });
});

function addSchedule(h: ReturnType<typeof harness>, patch: Partial<Schedule> = {}): Schedule {
  return h.store.insertSchedule({
    id: patch.id ?? `s-${Math.random().toString(36).slice(2, 8)}`,
    name: patch.name ?? "Daily digest",
    enabled: patch.enabled ?? true,
    cadence: patch.cadence ?? { kind: "daily", time: "09:00" },
    timezone: patch.timezone ?? "UTC",
    target: patch.target ?? { type: "task", agentId: "researcher", title: "Morning digest", instructions: "Summarise news", priority: 1 },
    overlap: patch.overlap ?? "skip",
    nextRunAt: patch.nextRunAt ?? new Date(Date.now() - 1000).toISOString(),
  });
}

describe("scheduler (runs in the worker; no browser involved)", () => {
  it("fires a due schedule exactly once per occurrence, even with two workers", () => {
    const h = harness(new ScriptedProvider([]));
    const s = addSchedule(h);
    const workerA = new Scheduler(h.store, h.config, false);
    const workerB = new Scheduler(h.store, h.config, false);
    const now = new Date();
    const fired = [...workerA.tick(now), ...workerB.tick(now)].filter((r) => r.fired);
    expect(fired).toHaveLength(1);
    const tasks = h.store.listTasks().filter((t) => t.scheduleId === s.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].createdBy).toBe(`schedule:${s.id}`);
    const after = h.store.getSchedule(s.id)!;
    expect(Date.parse(after.nextRunAt!)).toBeGreaterThan(now.getTime());
    expect(after.runCount).toBe(1);
    expect(workerA.tick(now)).toHaveLength(0); // not due any more
  });

  it("catches up ONCE after downtime instead of replaying every missed run", () => {
    const h = harness(new ScriptedProvider([]));
    const s = addSchedule(h, { cadence: { kind: "interval", everyMinutes: 60 }, nextRunAt: new Date(Date.now() - 3 * 86_400_000).toISOString() });
    const results = new Scheduler(h.store, h.config, false).tick();
    expect(results.filter((r) => r.fired)).toHaveLength(1);
    expect(Date.parse(h.store.getSchedule(s.id)!.nextRunAt!)).toBeGreaterThan(Date.now());
  });

  it("skips a run while the previous one is still in progress (overlap = skip)", () => {
    const h = harness(new ScriptedProvider([]));
    const s = addSchedule(h);
    const sched = new Scheduler(h.store, h.config, false);
    expect(sched.fire(s, "manual").fired).toBe(true);
    const second = sched.fire(s, "manual");
    expect(second).toMatchObject({ fired: false, outcome: "previous run still in progress" });
    expect(h.store.getSchedule(s.id)!.lastOutcome).toBe("previous run still in progress");
    const queued = addSchedule(h, { overlap: "queue" });
    expect(sched.fire(queued, "manual").fired).toBe(true);
    expect(sched.fire(queued, "manual").fired).toBe(true);
  });

  it("skips when the budget is exhausted or the agent has left town", () => {
    const h = harness(new ScriptedProvider([]), { dailyBudgetUsd: 1 });
    h.store.recordUsage({
      agentId: "manager", taskId: null, model: "claude-opus-5-5", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      webSearchRequests: 0, webFetchRequests: 0, codeExecutions: 0, costUsd: 2, simulated: false, requestId: "req_x", requestedModel: null,
    });
    const s = addSchedule(h);
    expect(new Scheduler(h.store, h.config, false).fire(s, "manual")).toMatchObject({ fired: false, outcome: "budget limit reached" });

    const h2 = harness(new ScriptedProvider([]));
    h2.store.updateAgent("researcher", { archived: true, enabled: false });
    const s2 = addSchedule(h2);
    const r = new Scheduler(h2.store, h2.config, false).fire(s2, "manual");
    expect(r.fired).toBe(false);
    expect(r.outcome).toMatch(/not available/);
  });

  it("can schedule the whole campaign workflow, and the worker runs it to completion", async () => {
    const h = harness(new ScriptedProvider([say("brief"), say("research"), say("copy"), say("final deliverable")]));
    const s = addSchedule(h, { target: { type: "campaign", topic: "Weekly newsletter ideas", audience: "", goal: "" } });
    await h.runner.tick(); // the worker's poll runs the scheduler
    await h.runner.drain();
    const wf = h.store.listWorkflows().find((w) => w.scheduleId === s.id)!;
    expect(wf.status).toBe("completed");
    expect(h.store.getTask(wf.finalTaskId!)!.output).toBe("final deliverable");
    expect(h.store.listEvents({ limit: 200 }).some((e) => e.type === "schedule.fired")).toBe(true);
  });
});

describe("schedules API", () => {
  it("validates input and computes the next run", async () => {
    const h = harness(new ScriptedProvider([]));
    const post = (body: unknown) => h.request("/api/schedules", { method: "POST", body: JSON.stringify(body) });
    const target = { type: "task", agentId: "researcher", title: "Digest", instructions: "Summarise", priority: 1 };
    expect((await post({ name: "x", cadence: { kind: "interval", everyMinutes: 5 }, timezone: "UTC", target })).status).toBe(400);
    expect((await post({ name: "x", cadence: { kind: "daily", time: "09:00" }, timezone: "Mars/Olympus", target })).status).toBe(400);
    expect((await post({ name: "x", cadence: { kind: "daily", time: "09:00" }, timezone: "UTC", target: { ...target, agentId: "ghost" } })).status).toBe(400);
    const ok = await post({ name: "Morning digest", cadence: { kind: "weekly", days: [1, 3, 5], time: "08:30" }, timezone: "Europe/Paris", target });
    expect(ok.status).toBe(201);
    const s = await ok.json();
    expect(Date.parse(s.nextRunAt)).toBeGreaterThan(Date.now());

    const paused = await (await h.request(`/api/schedules/${s.id}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) })).json();
    expect(paused.nextRunAt).toBeNull();
    const run = await h.request(`/api/schedules/${s.id}/run`, { method: "POST", body: "{}" });
    expect(run.status).toBe(200);
    expect(h.store.listTasks().some((t) => t.scheduleId === s.id)).toBe(true);
    expect((await h.request(`/api/schedules/${s.id}`, { method: "DELETE" })).status).toBe(200);
  });
});
