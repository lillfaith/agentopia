import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "../server/llm/models.js";
import { costSplit, taskUsageBreakdown } from "../server/llm/usage.js";
import { DEPTHS, capEffort, depthSpendCap, planTaskRun } from "../server/engine/depth.js";
import { AnthropicProvider, hostedToolDefinitions, withWrapUpNote } from "../server/llm/anthropic.js";
import { WRAP_UP_NOTE } from "../server/engine/executor.js";
import { buildBrief } from "../server/agents/prompt.js";
import type { UsageRecord } from "../shared/types.js";
import { ScriptedProvider, callTool, harness, say } from "./helpers.js";

/** Real usage rows recorded by the cost probe against the live API (before the optimisation). */
const SONNET_RESEARCH = { inputTokens: 201, cacheReadTokens: 42_091, cacheWriteTokens: 9_547, outputTokens: 2_884, webSearchRequests: 5 };
const HAIKU_RESEARCH = { inputTokens: 195, cacheReadTokens: 33_688, cacheWriteTokens: 46_488, outputTokens: 9_183, webSearchRequests: 5 };
const HAIKU_FOLLOW_UP = { inputTokens: 50_663, cacheReadTokens: 4_418, cacheWriteTokens: 0, outputTokens: 5_394, webSearchRequests: 0 };

describe("cost accounting", () => {
  it("matches what the treasury recorded for real calls, charging each token category once", () => {
    expect(estimateCostUsd("claude-sonnet-5-5", SONNET_RESEARCH)).toBeCloseTo(0.111528, 6);
    expect(estimateCostUsd("claude-haiku-5-5", HAIKU_RESEARCH)).toBeCloseTo(0.060759, 6);
    expect(estimateCostUsd("claude-haiku-5-5", HAIKU_FOLLOW_UP)).toBeCloseTo(0.007807, 6);

    const s = costSplit("claude-sonnet-5-5", SONNET_RESEARCH);
    expect(s).toMatchObject({ freshInputUsd: 0.000402, cacheReadUsd: 0.008418, cacheWriteUsd: 0.023868, outputUsd: 0.02884, webSearchUsd: 0.05 });
    expect(s.freshInputUsd + s.cacheReadUsd + s.cacheWriteUsd + s.outputUsd + s.webSearchUsd).toBeCloseTo(s.totalUsd, 6);
    // Cache reads are billed at a tenth of Sonnet's input price, not at the full price on top of it.
    expect(s.cacheReadUsd).toBeCloseTo((42_091 * 0.2) / 1e6, 6);
  });

  it("breaks a task down by charge and explains where the tokens went", () => {
    const row = (id: number, u: typeof HAIKU_RESEARCH, extra: Partial<UsageRecord> = {}): UsageRecord => ({
      id,
      ts: "2026-10-09T00:00:00Z",
      agentId: "researcher",
      taskId: "t1",
      model: "claude-haiku-5-5",
      ...u,
      webFetchRequests: 0,
      codeExecutions: 0,
      costUsd: estimateCostUsd("claude-haiku-5-5", u),
      simulated: false,
      requestId: `req_${id}`,
      requestedModel: "claude-haiku-5-5",
      ...extra,
    });
    const b = taskUsageBreakdown("t1", "standard", [row(1, HAIKU_RESEARCH, { thinkingTokens: 8_610 }), row(2, HAIKU_FOLLOW_UP)]);
    expect(b.totals).toMatchObject({
      apiCalls: 2,
      freshInputTokens: 50_858,
      cacheReadTokens: 38_106,
      cacheWriteTokens: 46_488,
      outputTokens: 14_577,
      thinkingTokens: 8_610,
      allTokens: 150_029,
      webSearches: 5,
    });
    expect(b.cost.totalUsd).toBeCloseTo(0.068566, 6);
    expect(b.cost.recordedUsd).toBeCloseTo(b.cost.totalUsd, 6);
    expect(b.cost.webSearchUsd).toBe(0.05);
    expect(b.models).toEqual(["claude-haiku-5-5"]);
    expect(b.notes.join(" ")).toMatch(/prompt cache/);
    expect(b.notes.join(" ")).not.toMatch(/differs/);
  });

  it("serves the breakdown over the API", async () => {
    const h = harness(new ScriptedProvider([() => ({ text: "done", usage: { ...SONNET_RESEARCH, webFetchRequests: 2 }, serverIterations: 6, thinkingTokens: 158, contextTokens: 9_549 })]));
    const task = h.store.createTask({ agentId: "researcher", title: "R", instructions: "x", createdBy: "user", modelOverride: "claude-sonnet-5-5" });
    await h.runner.drain();
    const res = await h.request(`/api/tasks/${task.id}/usage`);
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.totals).toMatchObject({ apiCalls: 1, serverIterations: 6, cacheReadTokens: 42_091, webSearches: 5, webFetches: 2, thinkingTokens: 158, peakContextTokens: 9_549 });
    expect(b.cost.totalUsd).toBeCloseTo(0.111528, 6);
    expect(b.depth).toBe("standard");
    expect((await h.request("/api/tasks/nope/usage")).status).toBe(404);
  });
});

describe("research depth", () => {
  const agent = { model: "claude-sonnet-5-5", effort: "high" as const };

  it("uses the cheapest allowed model for Quick research unless the task picks one", () => {
    const opts = { defaultDepth: "standard" as const, allowedModels: ["claude-haiku-5-5", "claude-sonnet-5-5"], research: true };
    expect(planTaskRun({ depth: "quick", modelOverride: null }, agent, opts)).toMatchObject({ model: "claude-haiku-5-5", effort: "low" });
    expect(planTaskRun({ depth: "quick", modelOverride: "claude-sonnet-5-5" }, agent, opts)).toMatchObject({ model: "claude-sonnet-5-5", effort: "low" });
    expect(planTaskRun({ depth: null, modelOverride: null }, agent, opts)).toMatchObject({ model: "claude-sonnet-5-5", effort: "medium", depth: { id: "standard" } });
    // A model outside the plan is ignored, never used.
    expect(planTaskRun({ depth: "deep", modelOverride: "claude-opus-5-5" }, agent, opts)).toMatchObject({ model: "claude-sonnet-5-5", effort: "high" });
    // Villagers without web research keep their own model and effort.
    expect(planTaskRun({ depth: "quick", modelOverride: null }, agent, { ...opts, research: false })).toMatchObject({ model: "claude-sonnet-5-5", effort: "high" });
  });

  it("caps effort and scales the spend ceiling for pricier models only", () => {
    expect(capEffort("high", "medium")).toBe("medium");
    expect(capEffort("low", "medium")).toBe("low");
    expect(depthSpendCap(DEPTHS.standard, "claude-sonnet-5-5")).toBe(0.35);
    expect(depthSpendCap(DEPTHS.standard, "claude-opus-5-5")).toBe(0.7);
    expect(depthSpendCap(DEPTHS.standard, "claude-haiku-5-5")).toBe(0.35);
  });

  it("limits web searches, page reads and page size on the hosted tools", () => {
    const tools = hostedToolDefinitions(["web_search", "web_fetch"], true, { webSearchMaxUses: 3, webFetchMaxUses: 2, webFetchMaxContentTokens: 4000 });
    expect(tools).toEqual([
      { type: "web_search_20260209", name: "web_search", max_uses: 3 },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 2, max_content_tokens: 4000 },
    ]);
    expect(hostedToolDefinitions(["web_search"], false)).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]);
  });

  it("tells the villager its research budget in the brief", () => {
    const h = harness(new ScriptedProvider([]));
    const task = h.store.createTask({ agentId: "researcher", title: "R", instructions: "x", createdBy: "user" });
    expect(buildBrief(h.store, task, { searches: 6, fetches: 4 })).toMatch(/up to 6 web searches and 4 page reads/);
    expect(buildBrief(h.store, task)).not.toMatch(/Research budget/);
  });

  it("writes up instead of searching again once the depth's searches are used", async () => {
    const provider = new ScriptedProvider([
      // Turn 1: four searches (Standard's whole allowance), then saves a note.
      (req) => ({ ...callTool("remember", { note: "Protein bars: ALOHA leads." })(req), usage: { inputTokens: 100, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 3000, webSearchRequests: 4 } }),
      say("Final brief with [sources](https://example.com)."),
    ]);
    const h = harness(provider);
    const task = h.store.createTask({ agentId: "researcher", title: "Scan", instructions: "x", createdBy: "user", depth: "standard" });
    await h.runner.drain();
    expect(h.store.getTask(task.id)).toMatchObject({ status: "completed", output: "Final brief with [sources](https://example.com)." });
    expect(provider.calls[0].noTools).toBeUndefined();
    expect(provider.calls[0].hostedLimits).toEqual({ webSearchMaxUses: 4, webFetchMaxUses: 3, webFetchMaxContentTokens: 8000 });
    expect(provider.calls[0].effort).toBe("medium"); // Pip's "high", capped by Standard
    expect(provider.calls[1].noTools).toBe(true);
    expect(provider.calls[1].maxTokens).toBeLessThanOrEqual(8000);
    // The note is part of the stored transcript, exactly as the model saw it.
    const sent = provider.calls[1].messages as { content: unknown }[];
    expect(JSON.stringify(sent[sent.length - 1])).toContain("research budget for this task is used up");
    expect(h.store.getConversation<{ messages: unknown[] }>(task.id)!.messages.slice(0, sent.length)).toEqual(sent);
    const steps = h.store.listEvents({ taskId: task.id }).map((e) => e.message);
    expect(steps.some((m) => /Standard research on/.test(m))).toBe(true);
    expect(steps.some((m) => /limit reached \(web searches\)/.test(m))).toBe(true);
  });

  it("falls back to a write-up when only that still fits the task budget", async () => {
    // The first call costs ~$0.12 (12k output tokens on Sonnet), leaving too little of the $0.30
    // task limit for another full research call (~$0.22 reserved) but enough for a write-up.
    const provider = new ScriptedProvider([
      (req) => ({ ...callTool("remember", { note: "n" })(req), usage: { inputTokens: 100, outputTokens: 12_000, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 1 } }),
      say("Brief."),
    ]);
    const h = harness(provider, { maxTaskCostUsd: 0.3 });
    const task = h.store.createTask({ agentId: "researcher", title: "Scan", instructions: "x", createdBy: "user", modelOverride: "claude-sonnet-5-5" });
    await h.runner.drain();
    expect(h.store.getTask(task.id)).toMatchObject({ status: "completed", output: "Brief." });
    expect(provider.calls[1].noTools).toBe(true);
  });
});

describe("prompt caching and the write-up call", () => {
  function sse(events: Array<[string, unknown]>): Response {
    const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_test" } });
  }
  const iteration = (input: number, read: number, write: number, output: number) => ({
    type: "message",
    input_tokens: input,
    cache_read_input_tokens: read,
    cache_creation_input_tokens: write,
    output_tokens: output,
    cache_creation: null,
    model: null,
  });
  const answer = () =>
    sse([
      ["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 4, output_tokens: 1, cache_read_input_tokens: 7331, cache_creation_input_tokens: 7470 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Brief." } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      [
        "message_delta",
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: {
            output_tokens: 436,
            output_tokens_details: { thinking_tokens: 40 },
            iterations: [iteration(2, 0, 7331, 339), iteration(2, 7331, 139, 97)],
          },
        },
      ],
      ["message_stop", { type: "message_stop" }],
    ]);

  it("caches the conversation, limits tools and reports per-iteration detail", async () => {
    const seen: Record<string, any>[] = [];
    const p = new AnthropicProvider("k", "off", { fetch: (async (_u: unknown, init?: RequestInit) => (seen.push(JSON.parse(String(init?.body))), answer())) as typeof fetch, maxRetries: 0 });
    const base = { model: "claude-sonnet-5-5", effort: "medium" as const, system: "s", tools: [], hostedTools: ["web_search" as const], maxTokens: 16000 };
    const r = await p.generate({ ...base, messages: [p.userMessage("Research")], hostedLimits: { webSearchMaxUses: 6, webFetchMaxUses: 4, webFetchMaxContentTokens: 8000 } });
    expect(seen[0].cache_control).toEqual({ type: "ephemeral" });
    expect(seen[0].tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 6 }]);
    expect(seen[0].tool_choice).toBeUndefined();
    expect(r).toMatchObject({ thinkingTokens: 40, serverIterations: 2, contextTokens: 7472 });
    expect(r.usage).toMatchObject({ inputTokens: 4, cacheReadTokens: 7331, cacheWriteTokens: 7470, outputTokens: 436 });

    await p.generate({ ...base, messages: p.appendNote([p.userMessage("Research")], WRAP_UP_NOTE), noTools: true });
    expect(seen[1].tool_choice).toEqual({ type: "none" });
    // The note rides on the last user turn; earlier messages are untouched.
    expect(seen[1].messages).toEqual([{ role: "user", content: [{ type: "text", text: "Research" }, { type: "text", text: WRAP_UP_NOTE }] }]);
  });

  it("adds the write-up note without editing earlier turns", () => {
    const history = [
      { role: "user" as const, content: "brief" },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "searching" }] },
    ];
    const out = withWrapUpNote(history, "wrap up");
    expect(out.slice(0, 2)).toEqual(history);
    expect(out[2]).toEqual({ role: "user", content: "wrap up" });
    expect(history).toHaveLength(2);
  });
});
