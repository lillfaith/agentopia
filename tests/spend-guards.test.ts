import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AnthropicProvider, rateLimitFrom } from "../server/llm/anthropic.js";
import { NonRetryableError } from "../server/llm/provider.js";
import { HIRING_DESK } from "../server/agents/drafts.js";
import { ScriptedProvider, harness } from "./helpers.js";

const WORKFLOWS = path.join(__dirname, "..", ".github", "workflows");

/** The `on:` block of a workflow file (everything from `on:` up to the next top-level key). */
function triggers(yaml: string): string {
  const m = yaml.match(/^on:\s*\n([\s\S]*?)(?=^\S)/m);
  return m ? m[1] : "";
}

describe("paid API spend guards", () => {
  it("never runs a workflow that holds an API key on a push, pull request or schedule", () => {
    const files = fs.readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    const paid = files.filter((f) => /ANTHROPIC_API_KEY|ANTHROPIC_KEY|CLAUDE_API_KEY/.test(fs.readFileSync(path.join(WORKFLOWS, f), "utf8")));
    expect(paid.length).toBeGreaterThan(0);
    for (const f of paid) {
      const on = triggers(fs.readFileSync(path.join(WORKFLOWS, f), "utf8"));
      expect(on, `${f} must be started by hand (workflow_dispatch only)`).toMatch(/workflow_dispatch/);
      expect(on, `${f} must not run automatically`).not.toMatch(/\b(push|pull_request|pull_request_target|schedule|workflow_run)\s*:/);
    }
  });

  it("keeps the unit-test workflow free of API keys", () => {
    const ci = fs.readFileSync(path.join(WORKFLOWS, "ci.yml"), "utf8");
    expect(ci).not.toMatch(/ANTHROPIC|CLAUDE_API_KEY|secrets\./);
  });
});


function sse(events: Array<[string, unknown]>, headers: Record<string, string> = {}): Response {
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_test", ...headers } });
}
const reply = (headers: Record<string, string>) =>
  sse(
    [
      ["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }],
      ["message_stop", { type: "message_stop" }],
    ],
    headers,
  );
const ask = (p: AnthropicProvider) => p.generate({ model: "claude-haiku-5-5", effort: "low", system: "s", messages: [p.userMessage("x")], tools: [], hostedTools: [], maxTokens: 100 });

describe("provider limits and errors", () => {
  it("records the rate-limit headers of the latest response (and no credentials)", async () => {
    const p = new AnthropicProvider("sk-ant-test", "off", {
      fetch: (async () =>
        reply({
          "anthropic-ratelimit-requests-limit": "50",
          "anthropic-ratelimit-requests-remaining": "49",
          "anthropic-ratelimit-requests-reset": "2026-10-10T12:00:00Z",
          "anthropic-ratelimit-input-tokens-limit": "30000",
          "anthropic-ratelimit-input-tokens-remaining": "1200",
        })) as typeof fetch,
      maxRetries: 0,
    });
    await ask(p);
    expect(p.lastRateLimit).toMatchObject({ requests: { limit: 50, remaining: 49 }, inputTokens: { limit: 30000, remaining: 1200 } });
    expect(JSON.stringify(p.lastRateLimit)).not.toContain("sk-ant");
    expect(rateLimitFrom(new Headers({ "content-type": "x" }))).toBeNull();
  });

  it("says which limit a 429 hit, and that credits ran out without retrying", async () => {
    const limited = new AnthropicProvider("k", "off", {
      fetch: (async () =>
        new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "20", "anthropic-ratelimit-input-tokens-limit": "30000", "anthropic-ratelimit-input-tokens-remaining": "0" },
        })) as typeof fetch,
      maxRetries: 0,
    });
    await expect(ask(limited)).rejects.toThrow(/input tokens per minute used up; retry after 20s/);
    const broke = new AnthropicProvider("k", "off", {
      fetch: (async () =>
        new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
      maxRetries: 0,
    });
    const err = await ask(broke).catch((e) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect(err.message).toMatch(/credit balance is too low.*Billing/);
  });
});

describe("no paid calls without work", () => {
  it("an idle town browsed, customised and inspected makes zero AI calls", async () => {
    const p = new ScriptedProvider([]); // any call would throw "ran out of steps"
    const h = harness(p);
    for (const path of ["/api/snapshot", "/api/status", "/api/treasury", "/api/agents/researcher", "/api/templates", "/api/schedules"]) {
      expect((await h.request(path)).status).toBeLessThan(500);
    }
    await h.request("/api/agents/researcher", { method: "PATCH", body: JSON.stringify({ appearance: { ...h.store.getAgent("researcher")!.appearance, bodyColor: "#a7e8bd" } }) });
    await h.runner.drain();
    await h.runner.drain();
    expect(p.calls).toHaveLength(0);
    expect(h.store.spendSince("2000-01-01")).toBe(0);
  });
});

describe("Treasury breakdown", () => {
  it("splits spend by who paid and what it was for, and lists the costliest tasks", async () => {
    const h = harness(new ScriptedProvider([]));
    const row = (agentId: string, taskId: string | null, cost: number, extra: Record<string, unknown> = {}) =>
      h.store.recordUsage({ agentId, taskId, model: "claude-haiku-5-5", inputTokens: 1000, outputTokens: 500, cacheReadTokens: 4000, cacheWriteTokens: 0, webSearchRequests: 1, webFetchRequests: 0, codeExecutions: 0, costUsd: cost, simulated: false, requestId: "r", requestedModel: null, ...extra });
    const mine = h.store.createTask({ agentId: "researcher", title: "Mine", instructions: "x", createdBy: "user" });
    const delegated = h.store.createTask({ agentId: "copywriter", title: "Delegated", instructions: "x", createdBy: "manager" });
    const scheduled = h.store.createTask({ agentId: "copywriter", title: "Nightly", instructions: "x", createdBy: "schedule:s1" });
    row("researcher", mine.id, 0.05);
    row("researcher", mine.id, 0.02);
    row("copywriter", delegated.id, 0.01);
    row("copywriter", scheduled.id, 0.004);
    row(HIRING_DESK, null, 0.0003);
    row("researcher", mine.id, 0.03, { billing: "own" });
    h.store.updateTask(mine.id, { attempts: 2 });
    {
      const s = await (await h.request("/api/treasury")).json();
      const op = (id: string) => s.operations.find((o: { id: string }) => o.id === id);
      expect(op("work")).toMatchObject({ requests: 3 });
      expect(op("work").costUsd).toBeCloseTo(0.1, 6);
      expect(op("delegated").costUsd).toBeCloseTo(0.01, 6);
      expect(op("scheduled").costUsd).toBeCloseTo(0.004, 6);
      expect(op("hiring-desk").costUsd).toBeCloseTo(0.0003, 6);
      expect(s.funding.find((f: { billing: string }) => f.billing === "own").costUsd).toBeCloseTo(0.03, 6);
      expect(s.topTasks[0]).toMatchObject({ title: "Mine", requests: 3, searches: 3, attempts: 2 });
      expect(s.retries).toEqual({ tasks: 1, extraAttempts: 1 });
      expect(s.categories).toMatchObject({ freshInput: 6000, cacheRead: 24000, output: 3000, webSearches: 6 });
      expect(s.categories.costs.webSearchUsd).toBeCloseTo(0.06, 6);
      expect(s.costBasis).toBe("estimated");
      expect(s.rateLimit).toBeNull();
    }
  });
});
