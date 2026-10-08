import { describe, expect, it } from "vitest";
import { capabilitiesFor } from "../server/skills/index.js";
import { buildSystemPrompt } from "../server/agents/prompt.js";
import { hostedToolDefinitions } from "../server/llm/anthropic.js";
import { budgetStatus, effectiveLimits, worstCaseCallCost } from "../server/engine/budget.js";
import { SimulatedProvider } from "../server/llm/simulated.js";
import { TaskRunner } from "../server/engine/runner.js";
import { callTool, harness, say, ScriptedProvider } from "./helpers.js";

const spend = (h: ReturnType<typeof harness>, costUsd: number, agentId = "manager", taskId: string | null = null) =>
  h.store.recordUsage({
    agentId, taskId, model: "claude-opus-5-5", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    webSearchRequests: 0, webFetchRequests: 0, codeExecutions: 0, costUsd, simulated: false, requestId: "req_x", requestedModel: null,
  });

describe("strict budgets", () => {
  it("reserves the worst case BEFORE a call, so a call that could cross the cap never starts", async () => {
    const provider = new ScriptedProvider([say("nope")]);
    const h = harness(provider, { dailyBudgetUsd: 1 });
    spend(h, 0.9); // under the cap, but one Opus call may cost up to ~$0.32
    expect(worstCaseCallCost({ model: "claude-opus-5-5", promptChars: 3000, maxTokens: 16000, hostedTools: [] })).toBeGreaterThan(0.1);
    const task = h.store.createTask({ agentId: "manager", title: "T", instructions: "x", createdBy: "user" });
    await h.runner.drain();
    expect(provider.calls).toHaveLength(0);
    const t = h.store.getTask(task.id)!;
    expect(t.status).toBe("queued");
    expect(t.attempts).toBe(0); // the attempt was given back
    expect(Date.parse(t.runAfter!)).toBeGreaterThan(Date.now()); // resumes when the day resets
  });

  it("fails a task that would exceed the per-task cap", async () => {
    const provider = new ScriptedProvider([say("nope")]);
    const h = harness(provider, { maxTaskCostUsd: 0.1 });
    const task = h.store.createTask({ agentId: "manager", title: "Big", instructions: "x", createdBy: "user" });
    await h.runner.drain();
    expect(provider.calls).toHaveLength(0);
    expect(h.store.getTask(task.id)).toMatchObject({ status: "failed" });
    expect(h.store.getTask(task.id)!.lastError).toMatch(/Per-task budget/);
  });

  it("pauses only the agent that hit its own daily cap", async () => {
    const provider = new ScriptedProvider([say("researched")]);
    const h = harness(provider);
    h.store.updateAgent("manager", { dailyBudgetUsd: 0.05 });
    spend(h, 0.06, "manager");
    const m = h.store.createTask({ agentId: "manager", title: "M", instructions: "x", createdBy: "user" });
    const r = h.store.createTask({ agentId: "researcher", title: "R", instructions: "x", createdBy: "user" });
    await h.runner.drain();
    expect(h.store.getTask(r.id)!.status).toBe("completed");
    expect(h.store.getTask(m.id)!.status).toBe("queued");
    expect(budgetStatus(h.store, h.config).agentHolds).toEqual(["manager"]);
  });

  it("lets the owner lower — never raise — the operator's hard limits", () => {
    const h = harness(new ScriptedProvider([]), { dailyBudgetUsd: 5, monthlyBudgetUsd: 50, maxTaskCostUsd: 1 });
    h.store.updateSettings({ budget: { dailyUsd: 2, monthlyUsd: 500, perTaskUsd: null } });
    expect(effectiveLimits(h.store, h.config).effective).toEqual({ dailyUsd: 2, monthlyUsd: 50, perTaskUsd: 1 });
  });

  it("does not apply spend limits to the zero-cost simulator", async () => {
    const h = harness(new SimulatedProvider(0), { dailyBudgetUsd: 0.01 });
    spend(h, 1);
    const t = h.store.createTask({ agentId: "manager", title: "T", instructions: "x", createdBy: "user" });
    await h.runner.drain();
    expect(h.store.getTask(t.id)!.status).toBe("completed");
  });
});

describe("hiring, archiving and departments", () => {
  it("hires a villager from a template into a new department building", async () => {
    const h = harness(new ScriptedProvider([say("print('hi')")]));
    const b = await h.request("/api/buildings", { method: "POST", body: JSON.stringify({ name: "Gearworks", department: "Engineering", kind: "workshop", slot: "south" }) });
    expect(b.status).toBe(201);
    const building = await b.json();
    const clash = await h.request("/api/buildings", { method: "POST", body: JSON.stringify({ name: "Other", department: "X", kind: "workshop", slot: "south" }) });
    expect(clash.status).toBe(409);

    const snap = await (await h.request("/api/snapshot")).json();
    const tpl = snap.templates.find((t: { id: string }) => t.id === "engineer");
    const hire = await h.request("/api/agents", {
      method: "POST",
      body: JSON.stringify({ name: "Bolt", role: tpl.role, personality: tpl.personality, systemPrompt: tpl.systemPrompt, responsibilities: tpl.responsibilities, skills: tpl.skills, avatar: tpl.avatar, effort: tpl.effort, buildingId: building.id }),
    });
    expect(hire.status).toBe(201);
    const bolt = await hire.json();
    expect(bolt).toMatchObject({ id: "bolt", model: h.config.defaultModel, skills: ["coding", "writing", "memory"], buildingId: building.id, archived: false });

    // The new villager works like any other.
    const task = h.store.createTask({ agentId: "bolt", title: "Script", instructions: "x", createdBy: "user" });
    await h.runner.drain();
    expect(h.store.getTask(task.id)!.status).toBe("completed");

    // A department with residents can't be demolished.
    expect((await h.request(`/api/buildings/${building.id}`, { method: "DELETE" })).status).toBe(409);
  });

  it("archives a villager: keeps history, cancels queued work, pauses its schedules, hides it from delegation", async () => {
    const h = harness(new ScriptedProvider([callTool("delegate_task", { agent_id: "researcher", title: "x", instructions: "y" }), say("ok")]));
    const queued = h.store.createTask({ agentId: "copywriter", title: "Later", instructions: "x", createdBy: "user" });
    h.store.insertSchedule({
      id: "sch", name: "Copy daily", enabled: true, cadence: { kind: "daily", time: "09:00" }, timezone: "UTC",
      target: { type: "task", agentId: "copywriter", title: "t", instructions: "i", priority: 1 }, overlap: "skip", nextRunAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect((await h.request("/api/agents/copywriter", { method: "DELETE" })).status).toBe(200);
    expect(h.store.getAgent("copywriter")).toMatchObject({ archived: true, enabled: false });
    expect(h.store.getTask(queued.id)!.status).toBe("cancelled");
    expect(h.store.getSchedule("sch")!.enabled).toBe(false);
    expect((await h.request("/api/agents/copywriter", { method: "PATCH", body: JSON.stringify({ name: "Z" }) })).status).toBe(409);
    expect((await h.request("/api/tasks", { method: "POST", body: JSON.stringify({ agentId: "copywriter", title: "t", instructions: "i" }) })).status).toBe(400);

    h.store.createTask({ agentId: "manager", title: "Delegate", instructions: "x", createdBy: "user" });
    await h.runner.drain();
    const provider = h.runner.provider as ScriptedProvider;
    const schema = provider.calls[0].tools.find((t) => t.name === "delegate_task")!.inputSchema as { properties: { agent_id: { enum: string[] } } };
    expect(schema.properties.agent_id.enum).toEqual(["researcher"]);

    const restored = await (await h.request("/api/agents/copywriter/restore", { method: "POST", body: "{}" })).json();
    expect(restored).toMatchObject({ archived: false, enabled: true });
  });

  it("refuses to archive a villager in the middle of a task", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const h = harness(new ScriptedProvider([async () => (await gate, { text: "done" })]));
    h.store.createTask({ agentId: "manager", title: "Long", instructions: "x", createdBy: "user" });
    await h.runner.tick();
    expect((await h.request("/api/agents/manager", { method: "DELETE" })).status).toBe(409);
    release();
    await h.runner.drain();
  });
});

describe("modular skills", () => {
  it("maps skills to tools; planned skills contribute nothing", () => {
    const h = harness(new ScriptedProvider([]));
    const agent = { ...h.store.getAgent("researcher")!, skills: ["research", "coding", "delegation", "image_generation"] };
    const caps = capabilitiesFor(h.store, agent);
    expect(caps.hosted).toEqual(["web_search", "web_fetch", "code_execution"]);
    expect(caps.local.map((t) => t.id)).toEqual(["delegate_task"]);
    expect(caps.prompts).toHaveLength(3); // research, delegation, coding — not the planned image skill
    const system = buildSystemPrompt(agent, caps.prompts);
    expect(system).toContain("Your skills:");
    expect(system).toContain("Coding skill");
  });

  it("uses a single code sandbox when coding is combined with web research", () => {
    const types = (hosted: string[], dyn = true) => hostedToolDefinitions(hosted, dyn).map((t) => (t as { type: string }).type);
    expect(types(["web_search", "web_fetch"])).toEqual(["web_search_20260209", "web_fetch_20260209"]);
    expect(types(["web_search", "web_fetch", "code_execution"])).toEqual(["web_search_20250305", "web_fetch_20250910", "code_execution_20260521"]);
    expect(types(["web_search"], false)).toEqual(["web_search_20250305"]);
  });

  it("allows attaching planned skills but labels them as such", async () => {
    const h = harness(new ScriptedProvider([]));
    const snap = await (await h.request("/api/snapshot")).json();
    const planned = snap.status.skills.filter((s: { status: string }) => s.status === "planned").map((s: { id: string }) => s.id);
    expect(planned).toEqual(["image_generation", "3d_modeling"]);
    const ok = await h.request("/api/agents/copywriter", { method: "PATCH", body: JSON.stringify({ skills: ["writing", "image_generation"] }) });
    expect(ok.status).toBe(200);
  });
});

describe("proof of execution", () => {
  it("marks a task LIVE only when real API request ids were recorded", async () => {
    const h = harness(new ScriptedProvider([say("hello")]));
    const t = h.store.createTask({ agentId: "manager", title: "T", instructions: "x", createdBy: "user" });
    await h.runner.drain();
    const done = h.store.getTask(t.id)!;
    expect(done.execution).toMatchObject({ mode: "live", calls: 1, lastRequestId: "req_scripted_1" });
    expect(done.simulated).toBe(false);
  });

  it("marks simulator work SIMULATED, and re-labels a task re-run live", async () => {
    const sim = harness(new SimulatedProvider(0));
    const t = sim.store.createTask({ agentId: "manager", title: "T", instructions: "x", createdBy: "user" });
    await sim.runner.drain();
    expect(sim.store.getTask(t.id)!.execution.mode).toBe("simulated");
    expect(sim.store.getTask(t.id)!.simulated).toBe(true);

    // Same database, now with a real provider: retrying runs it live and the label follows.
    const live = new TaskRunner(sim.store, new ScriptedProvider([say("real answer")]), sim.config, { retryBaseMs: 1, statusDecayMs: 5 });
    sim.store.updateTask(t.id, { status: "failed" });
    expect(live.retryTask(t.id).ok).toBe(true);
    await live.drain();
    const rerun = sim.store.getTask(t.id)!;
    expect(rerun).toMatchObject({ status: "completed", simulated: false, output: "real answer" });
    expect(rerun.execution.mode).toBe("live");
  });
});

describe("exactly-once local tools", () => {
  it("reuses a recorded tool result instead of running the tool again after a crash", async () => {
    const provider = new ScriptedProvider([callTool("delegate_task", { agent_id: "researcher", title: "Once", instructions: "only once" }, "tu_once"), say("done")]);
    const h = harness(provider);
    const t = h.store.createTask({ agentId: "manager", title: "M", instructions: "x", createdBy: "user" });
    // Simulate: the delegation already ran before a crash, but the transcript was not yet updated.
    h.store.saveToolRun(t.id, "tu_once", "delegate_task", "Delegated as task X (recorded before crash)", false);
    await h.runner.drain();
    expect(h.store.listTasks().filter((x) => x.title === "Once")).toHaveLength(0); // not delegated twice
    const results = provider.calls[1].messages.at(-1) as { content: { content: string }[] };
    expect(results.content[0].content).toContain("recorded before crash");
  });
});
