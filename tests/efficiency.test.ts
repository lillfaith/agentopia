import { describe, expect, it } from "vitest";
import { DEPTHS, planTaskRun } from "../server/engine/depth.js";
import { MEMORY_IN_BRIEF, buildBrief, buildSystemPrompt, relevantMemories } from "../server/agents/prompt.js";
import { research } from "../server/skills/research.js";
import { ScriptedProvider, harness, say } from "./helpers.js";

const sonnetAgent = { model: "claude-sonnet-5-5", effort: "high" as const };
const plan = (depth: "quick" | "standard" | "deep" | null, preference: "economy" | "balanced" | "quality", research = true, modelOverride: string | null = null) =>
  planTaskRun({ depth, modelOverride }, sonnetAgent, { defaultDepth: "standard", allowedModels: ["claude-haiku-5-5", "claude-sonnet-5-5"], research, preference });

describe("model preference", () => {
  it("balanced (default) only lowers the model for Quick research", () => {
    expect(plan("quick", "balanced").model).toBe("claude-haiku-5-5");
    expect(plan("standard", "balanced").model).toBe("claude-sonnet-5-5");
    expect(plan(null, "balanced", false).model).toBe("claude-sonnet-5-5");
  });
  it("economy uses the cheapest allowed model except for Deep research", () => {
    expect(plan("standard", "economy").model).toBe("claude-haiku-5-5");
    expect(plan(null, "economy", false)).toMatchObject({ model: "claude-haiku-5-5", modelReason: "Economy mode uses the lower-cost model" });
    expect(plan("deep", "economy").model).toBe("claude-sonnet-5-5");
  });
  it("quality always keeps the employee's model, and a model picked on the task always wins", () => {
    expect(plan("quick", "quality").model).toBe("claude-sonnet-5-5");
    expect(plan("quick", "economy", true, "claude-sonnet-5-5").model).toBe("claude-sonnet-5-5");
    expect(plan(null, "economy", false, "claude-sonnet-5-5").model).toBe("claude-sonnet-5-5");
  });
  it("applies the town setting at run time without touching the employee", async () => {
    const p = new ScriptedProvider([say("done")]);
    const h = harness(p);
    h.store.updateSettings({ modelPreference: "economy" });
    h.store.updateAgent("copywriter", { model: "claude-sonnet-5-5" });
    h.store.createTask({ agentId: "copywriter", title: "Tagline", instructions: "Write one tagline", createdBy: "user" });
    await h.runner.drain();
    expect(p.calls[0].model).toBe("claude-haiku-5-5");
    expect(h.store.getAgent("copywriter")!.model).toBe("claude-sonnet-5-5");
  });
});

describe("research defaults", () => {
  it("answers established knowledge first and searches to verify and cite", () => {
    expect(research.prompt).toMatch(/well-established knowledge from what you already know/);
    expect(research.prompt).toMatch(/don't repeat a search/);
    expect(research.prompt).toMatch(/cite the key claims/);
    // Benchmark finding: a request that asks for sources must still get searched, linked sources.
    expect(research.prompt).toMatch(/asks for sources, links or citations, verify each key claim with a search/);
    expect(research.prompt).toMatch(/never a link from memory/);
    expect(research.prompt).not.toMatch(/anything time-sensitive or factual/);
  });
  it("keeps Quick light, Standard balanced and Deep extensive", () => {
    expect([DEPTHS.quick.maxSearches, DEPTHS.standard.maxSearches, DEPTHS.deep.maxSearches]).toEqual([3, 4, 12]);
    expect([DEPTHS.quick.maxFetches, DEPTHS.standard.maxFetches, DEPTHS.deep.maxFetches]).toEqual([2, 3, 10]);
    expect(DEPTHS.quick.maxTaskUsd).toBeLessThan(DEPTHS.standard.maxTaskUsd);
    expect(DEPTHS.standard.maxTaskUsd).toBeLessThan(DEPTHS.deep.maxTaskUsd);
  });
});

describe("context stays bounded", () => {
  it("puts at most ten notes in a brief: the latest few plus the relevant ones", () => {
    const notes = Array.from({ length: 40 }, (_, i) => ({ content: i === 30 ? "Channel audience: students who love ramen" : `Unrelated note number ${i}` }));
    const picked = relevantMemories(notes, "Plan a ramen video for the channel");
    expect(picked.length).toBeLessThanOrEqual(MEMORY_IN_BRIEF);
    expect(picked.map((n) => n.content)).toContain("Channel audience: students who love ramen");
    expect(picked.map((n) => n.content)).toContain("Unrelated note number 0"); // newest is always kept
    expect(relevantMemories(notes.slice(0, 4), "x")).toHaveLength(4);
  });

  it("doesn't grow the brief with an employee's whole memory", () => {
    const h = harness(new ScriptedProvider([]));
    for (let i = 0; i < 60; i++) h.store.addMemory("researcher", `Note ${i}: ${"detail ".repeat(20)}`, null);
    const task = h.store.createTask({ agentId: "researcher", title: "Scan", instructions: "Find prices", createdBy: "user" });
    const brief = buildBrief(h.store, task);
    expect((brief.match(/^- Note /gm) ?? []).length).toBeLessThanOrEqual(MEMORY_IN_BRIEF);
    // The system prompt goes in the system field only, never repeated into the conversation.
    const system = buildSystemPrompt(h.store.getAgent("researcher")!);
    expect(brief).not.toContain(system.slice(0, 80));
  });
});

describe("duplicate work", () => {
  it("doesn't start the same job twice while it's waiting or running", async () => {
    const h = harness(new ScriptedProvider([say("done")]));
    const body = { agentId: "copywriter", title: "Tagline options", instructions: "Write three taglines." };
    const first = await h.request("/api/tasks", { method: "POST", body: JSON.stringify(body) });
    expect(first.status).toBe(201);
    const again = await h.request("/api/tasks", { method: "POST", body: JSON.stringify({ ...body, title: "  tagline   OPTIONS " }) });
    expect(again.status).toBe(409);
    expect((await again.json()).duplicateOf).toBe((await first.json()).id);
    await h.runner.drain();
    // Once it's finished, asking again is a deliberate re-run.
    expect((await h.request("/api/tasks", { method: "POST", body: JSON.stringify(body) })).status).toBe(201);
  });
});
