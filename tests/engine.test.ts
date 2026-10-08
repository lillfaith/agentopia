import { describe, expect, it } from "vitest";
import { SimulatedProvider, SIMULATION_BANNER } from "../server/llm/simulated.js";
import { NonRetryableError } from "../server/llm/provider.js";
import { startCampaignWorkflow } from "../server/engine/workflows.js";
import { callTool, harness, say, ScriptedProvider } from "./helpers.js";

describe("seed", () => {
  it("creates three agents and three buildings, idempotently", async () => {
    const h = harness(new ScriptedProvider([]));
    expect(h.store.listAgents().map((a) => a.role)).toEqual(["Manager", "Researcher", "Copywriter"]);
    expect(h.store.listBuildings()).toHaveLength(3);
    const { seedTown } = await import("../server/agents/seed.js");
    seedTown(h.store, "claude-opus-5-5");
    expect(h.store.listAgents()).toHaveLength(3);
  });
});

describe("campaign workflow (Manager → Researcher → Copywriter → Manager)", () => {
  it("runs the whole chain in dependency order and hands work between agents", async () => {
    const h = harness(new SimulatedProvider(0));
    const wf = startCampaignWorkflow(h.store, { topic: "Lavender oat milk latte", audience: "Remote workers" });
    const tasks = h.store.listTasks({ workflowId: wf.id }).reverse();
    expect(tasks.map((t) => [t.agentId, t.status])).toEqual([
      ["manager", "queued"],
      ["researcher", "blocked"],
      ["copywriter", "blocked"],
      ["manager", "blocked"],
    ]);

    await h.runner.drain();

    const done = h.store.listTasks({ workflowId: wf.id }).reverse();
    expect(done.every((t) => t.status === "completed")).toBe(true);
    expect(done.every((t) => t.simulated)).toBe(true);
    expect(done[3].output).toContain(SIMULATION_BANNER);
    expect(h.store.getWorkflow(wf.id)?.status).toBe("completed");

    // Completion order follows the dependency chain.
    const order = h.store.listEvents({ limit: 1000 }).filter((e) => e.type === "task.completed").map((e) => e.taskId);
    expect(order).toEqual(done.map((t) => t.id));

    // Real hand-off events drive the world animation.
    const handoffs = h.store
      .listEvents({ limit: 1000 })
      .filter((e) => e.type === "task.handoff")
      .map((e) => `${e.data.fromAgentId}->${e.data.toAgentId}`);
    expect(handoffs).toEqual(["manager->researcher", "researcher->copywriter", "copywriter->manager"]);

    // The copywriter's brief contains the researcher's output.
    const state = h.store.getConversation<{ messages: { content: string }[] }>(done[2].id)!;
    expect(state.messages[0].content).toContain("<colleague_output>");
    expect(state.messages[0].content).toContain("Pip (Researcher)");

    // Simulated work costs nothing and is excluded from real-spend totals.
    expect(h.store.spendSince("1970-01-01T00:00:00Z")).toBe(0);
  });
});

describe("approvals", () => {
  it("pauses a sensitive tool call until a human approves, without running it early", async () => {
    const provider = new ScriptedProvider([
      callTool("publish_content", { channel: "blog", title: "Hello", body: "World" }),
      say("Published draft is ready."),
    ]);
    const h = harness(provider);
    const task = h.store.createTask({ agentId: "copywriter", title: "Post", instructions: "Write and publish", createdBy: "user" });
    await h.runner.drain();

    expect(h.store.getTask(task.id)?.status).toBe("waiting_approval");
    expect(h.store.getAgent("copywriter")?.status).toBe("waiting_approval");
    const [approval] = h.store.listApprovals({ taskId: task.id });
    expect(approval.status).toBe("pending");
    expect(approval.summary).toBe("Publish “Hello” to blog");
    // The placeholder tool has not executed yet.
    expect(h.store.listEvents({ taskId: task.id }).some((e) => e.data.tool === "publish_content")).toBe(false);
    expect(provider.calls).toHaveLength(1);

    expect(h.runner.decideApproval(approval.id, true, "ok").ok).toBe(true);
    expect(h.runner.decideApproval(approval.id, true, null).ok).toBe(false); // cannot decide twice
    await h.runner.drain();

    const finished = h.store.getTask(task.id)!;
    expect(finished.status).toBe("completed");
    expect(finished.output).toBe("Published draft is ready.");
    expect(h.store.listEvents({ taskId: task.id }).some((e) => e.data.tool === "publish_content" && e.data.placeholder)).toBe(true);
    // Second model call received the tool result for the approved call.
    const last = provider.calls[1].messages.at(-1) as { content: { toolCallId: string; isError?: boolean }[] };
    expect(last.content[0].toolCallId).toBe("tu_publish_content");
    expect(last.content[0].isError).toBeFalsy();
  });

  it("feeds a rejection back to the model as an error result", async () => {
    const provider = new ScriptedProvider([
      callTool("publish_content", { channel: "blog", title: "Hello", body: "World" }),
      say("Understood, not publishing."),
    ]);
    const h = harness(provider);
    const task = h.store.createTask({ agentId: "copywriter", title: "Post", instructions: "x", createdBy: "user" });
    await h.runner.drain();
    const [approval] = h.store.listApprovals({ taskId: task.id });
    h.runner.decideApproval(approval.id, false, "not yet");
    await h.runner.drain();
    const last = provider.calls[1].messages.at(-1) as { content: { content: string; isError?: boolean }[] };
    expect(last.content[0].isError).toBe(true);
    expect(last.content[0].content).toContain("not yet");
    expect(h.store.getTask(task.id)?.status).toBe("completed");
  });
});

describe("tool permissions", () => {
  it("refuses tools that are not on the agent's allowlist", async () => {
    const provider = new ScriptedProvider([
      callTool("delegate_task", { agent_id: "manager", title: "x", instructions: "y" }),
      say("done"),
    ]);
    const h = harness(provider);
    // The Researcher is not authorised to delegate.
    const task = h.store.createTask({ agentId: "researcher", title: "R", instructions: "x", createdBy: "user" });
    await h.runner.drain();
    const last = provider.calls[1].messages.at(-1) as { content: { content: string; isError?: boolean }[] };
    expect(last.content[0].isError).toBe(true);
    expect(last.content[0].content).toContain("not authorised");
    expect(h.store.listTasks()).toHaveLength(1); // nothing was delegated
    expect(h.store.getTask(task.id)?.status).toBe("completed");
    // Only authorised tools are offered to the model at all.
    expect(provider.calls[0].tools.map((t) => t.name)).toEqual([]);
    expect(provider.calls[0].hostedTools).toEqual(["web_search", "web_fetch"]);
  });

  it("lets the Manager delegate, with a depth limit", async () => {
    const provider = new ScriptedProvider([
      callTool("delegate_task", { agent_id: "researcher", title: "Look into X", instructions: "Find out about X" }),
      say("Delegated."),
      say("Research done."),
    ]);
    const h = harness(provider, { maxDelegationDepth: 1 });
    const task = h.store.createTask({ agentId: "manager", title: "M", instructions: "delegate", createdBy: "user" });
    await h.runner.drain();
    const child = h.store.listTasks().find((t) => t.parentTaskId === task.id)!;
    expect(child.agentId).toBe("researcher");
    expect(child.createdBy).toBe("manager");
    expect(child.delegationDepth).toBe(1);
    expect(child.status).toBe("completed");
    expect(h.store.listEvents({ limit: 500 }).some((e) => e.type === "task.handoff" && e.data.kind === "delegation")).toBe(true);
    // The delegate schema only lists other enabled agents.
    const schema = provider.calls[0].tools[0].inputSchema as { properties: { agent_id: { enum: string[] } } };
    expect(schema.properties.agent_id.enum).toEqual(["researcher", "copywriter"]);

    // A depth-1 task may not delegate further.
    const p2 = new ScriptedProvider([callTool("delegate_task", { agent_id: "copywriter", title: "t", instructions: "i" }), say("ok")]);
    const h2 = harness(p2, { maxDelegationDepth: 1 });
    h2.store.createTask({ agentId: "manager", title: "deep", instructions: "x", createdBy: "researcher", delegationDepth: 1 });
    await h2.runner.drain();
    const res = p2.calls[1].messages.at(-1) as { content: { content: string; isError?: boolean }[] };
    expect(res.content[0].isError).toBe(true);
    expect(res.content[0].content).toContain("depth limit");
  });
});

describe("failure handling", () => {
  it("retries transient errors with backoff, then succeeds", async () => {
    const provider = new ScriptedProvider([() => new Error("ECONNRESET"), say("second time lucky")]);
    const h = harness(provider);
    const task = h.store.createTask({ agentId: "manager", title: "T", instructions: "x", createdBy: "user" });
    await h.runner.drain();
    await new Promise((r) => setTimeout(r, 20));
    await h.runner.drain();
    const t = h.store.getTask(task.id)!;
    expect(t.status).toBe("completed");
    expect(t.attempts).toBe(2);
    expect(h.store.listEvents({ taskId: task.id }).some((e) => e.type === "task.retry_scheduled")).toBe(true);
  });

  it("fails fast on non-retryable errors and cascades to dependents and the workflow", async () => {
    const provider = new ScriptedProvider([() => new NonRetryableError("bad key")]);
    const h = harness(provider);
    const wf = startCampaignWorkflow(h.store, { topic: "Anything at all" });
    await h.runner.drain();
    const tasks = h.store.listTasks({ workflowId: wf.id });
    expect(tasks.every((t) => t.status === "failed")).toBe(true);
    expect(tasks.find((t) => t.agentId === "researcher")?.lastError).toContain("failed");
    expect(h.store.getWorkflow(wf.id)?.status).toBe("failed");
    expect(provider.calls).toHaveLength(1);
  });

  it("pauses (does not fail) queued work when the daily budget is spent, without calling the model", async () => {
    const provider = new ScriptedProvider([say("should not run")]);
    const h = harness(provider, { dailyBudgetUsd: 1 });
    h.store.recordUsage({
      agentId: "manager", taskId: null, model: "claude-opus-5-5", inputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0, webFetchRequests: 0, codeExecutions: 0, costUsd: 1.5, simulated: false, requestId: "req_x", requestedModel: null,
    });
    const task = h.store.createTask({ agentId: "manager", title: "T", instructions: "x", createdBy: "user" });
    await h.runner.drain();
    expect(provider.calls).toHaveLength(0);
    expect(h.store.getTask(task.id)?.status).toBe("queued");
    expect(h.store.listEvents({ limit: 50 }).some((e) => e.type === "budget.hold")).toBe(true);
  });

  it("re-queues tasks whose worker lease expired (crash recovery)", () => {
    const h = harness(new ScriptedProvider([]));
    const task = h.store.createTask({ agentId: "manager", title: "T", instructions: "x", createdBy: "user" });
    const claimed = h.store.claimNextTask("dead-worker", -1000); // lease already expired
    expect(claimed?.id).toBe(task.id);
    expect(h.store.requeueExpiredLeases().map((t) => t.id)).toEqual([task.id]);
    expect(h.store.getTask(task.id)?.status).toBe("queued");
  });

  it("runs one task per agent at a time, highest priority first", () => {
    const h = harness(new ScriptedProvider([]));
    const low = h.store.createTask({ agentId: "manager", title: "low", instructions: "x", createdBy: "user", priority: 0 });
    const urgent = h.store.createTask({ agentId: "manager", title: "urgent", instructions: "x", createdBy: "user", priority: 3 });
    const other = h.store.createTask({ agentId: "researcher", title: "r", instructions: "x", createdBy: "user", priority: 0 });
    expect(h.store.claimNextTask("w", 60_000)?.id).toBe(urgent.id);
    expect(h.store.claimNextTask("w", 60_000)?.id).toBe(other.id); // manager is busy
    expect(h.store.claimNextTask("w", 60_000)).toBeNull();
    void low;
  });
});

describe("usage tracking", () => {
  it("records tokens and estimated cost per call", async () => {
    const h = harness(new ScriptedProvider([say("hi")]));
    h.store.createTask({ agentId: "manager", title: "T", instructions: "x", createdBy: "user" });
    await h.runner.drain();
    const stats = h.store.agentStats().find((s) => s.agentId === "manager")!;
    expect(stats.inputTokens).toBe(1000);
    expect(stats.outputTokens).toBe(500);
    // claude-opus-5-5: 1000 * $4/M + 500 * $20/M = $0.014
    expect(stats.costUsd).toBeCloseTo(0.014, 6);
    expect(stats.tasksCompleted).toBe(1);
  });
});
