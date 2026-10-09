import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { assertSafeBinding } from "../server/config.js";
import { SimulatedProvider } from "../server/llm/simulated.js";
import { harness, say, ScriptedProvider, testConfig } from "./helpers.js";

describe("HTTP API", () => {
  it("serves a snapshot without leaking secrets", async () => {
    const h = harness(new ScriptedProvider([]), { anthropicApiKey: "sk-ant-secret-value" });
    const res = await h.request("/api/snapshot");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("sk-ant-secret-value");
    const snap = JSON.parse(text);
    expect(snap.agents).toHaveLength(3);
    expect(snap.status.provider.keyConfigured).toBe(true);
    const publishing = snap.status.skills.find((s: { id: string }) => s.id === "publishing");
    expect(publishing.tools[0]).toMatchObject({ id: "publish_content", requiresApproval: true, implementation: "placeholder" });
  });

  it("creates tasks and validates input", async () => {
    const h = harness(new ScriptedProvider([say("ok")]));
    const bad = await h.request("/api/tasks", { method: "POST", body: JSON.stringify({ agentId: "manager", title: "" }) });
    expect(bad.status).toBe(400);
    const unknown = await h.request("/api/tasks", { method: "POST", body: JSON.stringify({ agentId: "nobody", title: "t", instructions: "i" }) });
    expect(unknown.status).toBe(400);
    const ok = await h.request("/api/tasks", { method: "POST", body: JSON.stringify({ agentId: "manager", title: "Plan", instructions: "Do it", priority: 2 }) });
    expect(ok.status).toBe(201);
    const task = await ok.json();
    await h.runner.drain();
    const detail = await (await h.request(`/api/tasks/${task.id}`)).json();
    expect(detail.task.status).toBe("completed");
    expect(detail.events.map((e: { type: string }) => e.type)).toContain("task.completed");
  });

  it("updates agent configuration with a server-side skill allowlist", async () => {
    const h = harness(new ScriptedProvider([]));
    const bad = await h.request("/api/agents/researcher", { method: "PATCH", body: JSON.stringify({ skills: ["shell"] }) });
    expect(bad.status).toBe(400);
    const extra = await h.request("/api/agents/researcher", { method: "PATCH", body: JSON.stringify({ status: "working" }) });
    expect(extra.status).toBe(400); // status is not user-editable
    const ok = await h.request("/api/agents/researcher", {
      method: "PATCH",
      body: JSON.stringify({ name: "Pippa", model: "claude-sonnet-5-5", effort: "low", skills: ["research", "research", "coding"], dailyBudgetUsd: 0.5 }),
    });
    expect(ok.status).toBe(200);
    const agent = await ok.json();
    expect(agent).toMatchObject({ name: "Pippa", model: "claude-sonnet-5-5", effort: "low", skills: ["research", "coding"], dailyBudgetUsd: 0.5 });
  });

  it("starts the campaign workflow and exposes the deliverable", async () => {
    const h = harness(new SimulatedProvider(0));
    const res = await h.request("/api/workflows/campaign", { method: "POST", body: JSON.stringify({ topic: "Solar garden lights" }) });
    expect(res.status).toBe(201);
    const wf = await res.json();
    await h.runner.drain();
    const snap = await (await h.request("/api/snapshot")).json();
    const done = snap.workflows.find((w: { id: string }) => w.id === wf.id);
    expect(done.status).toBe("completed");
    const final = snap.tasks.find((t: { id: string }) => t.id === done.finalTaskId);
    expect(final.output).toContain("SIMULATED");
  });

  it("decides approvals through the API", async () => {
    const h = harness(new SimulatedProvider(0));
    await h.request("/api/tasks", { method: "POST", body: JSON.stringify({ agentId: "copywriter", title: "Publish a launch post", instructions: "x" }) });
    await h.runner.drain();
    const [approval] = await (await h.request("/api/approvals")).json();
    expect(approval.status).toBe("pending");
    const res = await h.request(`/api/approvals/${approval.id}/decide`, { method: "POST", body: JSON.stringify({ approve: true }) });
    expect(res.status).toBe(200);
    const again = await h.request(`/api/approvals/${approval.id}/decide`, { method: "POST", body: JSON.stringify({ approve: true }) });
    expect(again.status).toBe(409);
    await h.runner.drain();
    const tasks = await (await h.request("/api/tasks")).json();
    expect(tasks[0].status).toBe("completed");
  });

  it("computes the treasury and town-tax pledge without moving money", async () => {
    const h = harness(new ScriptedProvider([]));
    h.store.recordUsage({
      agentId: "manager", taskId: null, model: "claude-opus-5-5", inputTokens: 1_000_000, outputTokens: 0,
      cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0, webFetchRequests: 0, codeExecutions: 0, costUsd: 40, simulated: false, requestId: "req_x", requestedModel: null,
    });
    await h.request("/api/settings", { method: "PATCH", body: JSON.stringify({ townTax: { enabled: true, rate: 10, weeklyCapUsd: 3 } }) });
    const t = await (await h.request("/api/treasury")).json();
    expect(t.totals.costUsd).toBe(40);
    expect(t.byAgent[0].agentId).toBe("manager");
    expect(t.townTax.suggestedPledgeUsd).toBe(3); // 10% of $40 = $4, capped at $3
    expect(t.townTax.capped).toBe(true);
  });
});

describe("API security", () => {
  it("rejects non-JSON and cross-origin mutations (CSRF)", async () => {
    const h = harness(new ScriptedProvider([]));
    const form = await h.request("/api/tasks", { method: "POST", body: "agentId=manager", headers: { "content-type": "text/plain" } });
    expect(form.status).toBe(415);
    const cross = await h.request("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ agentId: "manager", title: "t", instructions: "i" }),
      headers: { origin: "https://evil.example" },
    });
    expect(cross.status).toBe(403);
  });

  it("rejects foreign Host headers in local mode (DNS rebinding)", async () => {
    const h = harness(new ScriptedProvider([]));
    const res = await h.request("/api/snapshot", { headers: { host: "attacker.example" } });
    expect(res.status).toBe(403);
  });

  it("requires the bearer token when one is configured", async () => {
    const h = harness(new ScriptedProvider([]), { adminToken: "a".repeat(40) });
    expect((await h.request("/api/snapshot")).status).toBe(401);
    expect((await h.request("/api/snapshot", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await h.request("/api/snapshot", { headers: { authorization: `Bearer ${"a".repeat(40)}` } })).status).toBe(200);
    expect((await h.request("/api/health")).status).toBe(200);
  });

  it("refuses to bind publicly without a token", () => {
    expect(() => assertSafeBinding({ host: "0.0.0.0", adminToken: null })).toThrow(/ADMIN_TOKEN/);
    expect(() => assertSafeBinding({ host: "0.0.0.0", adminToken: "x".repeat(32) })).not.toThrow();
  });

  it("never uses the simulator unless explicitly enabled", () => {
    const app = createApp(testConfig({ simulation: false }), { startWorker: false });
    expect(app.provider.simulated).toBe(false);
    const sim = createApp(testConfig({ simulation: true }), { startWorker: false });
    expect(sim.provider.simulated).toBe(true);
    const live = createApp(testConfig({ simulation: true, anthropicApiKey: "sk-ant-x" }), { startWorker: false });
    expect(live.provider.simulated).toBe(false); // a real key always wins
  });
});
