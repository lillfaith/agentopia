import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "../server/llm/anthropic.js";
import { NonRetryableError } from "../server/llm/provider.js";

function sse(events: Array<[string, unknown]>): Response {
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_test" } });
}

function streamedMessage(model: string, blocks: unknown[], stop: string, usage = { input_tokens: 120, output_tokens: 45 }) {
  const events: Array<[string, unknown]> = [
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input_tokens, output_tokens: 1, cache_read_input_tokens: 30, cache_creation_input_tokens: 0 } } }],
  ];
  blocks.forEach((b, index) => {
    const block = b as { type: string; text?: string; input?: unknown };
    if (block.type === "text") {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }]);
      events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } }]);
    } else {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { ...block, input: {} } }]);
      events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }]);
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push(["message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output_tokens } }]);
  events.push(["message_stop", { type: "message_stop" }]);
  return sse(events);
}

describe("AnthropicProvider", () => {
  it("sends effort, cached system prompt, tools and the default refusal fallback", async () => {
    const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return streamedMessage("claude-opus-5-5", [
        { type: "text", text: "Let me delegate." },
        { type: "tool_use", id: "toolu_1", name: "delegate_task", input: { agent_id: "researcher", title: "t", instructions: "i" } },
      ], "tool_use");
    };
    const p = new AnthropicProvider("sk-ant-test", "default", { fetch: fakeFetch as typeof fetch, maxRetries: 0 });
    const r = await p.generate({
      model: "claude-opus-5-5",
      effort: "medium",
      system: "You are Mabel.",
      messages: [p.userMessage("Plan the launch")],
      tools: [{ name: "delegate_task", description: "d", inputSchema: { type: "object", properties: {} } }],
      hostedTools: ["web_search"],
      maxTokens: 16000,
    });

    const req = seen[0];
    expect(req.url).toContain("/v1/messages");
    expect(req.headers.get("x-api-key")).toBe("sk-ant-test");
    expect(req.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(req.body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      stream: true,
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: [{ type: "text", text: "You are Mabel.", cache_control: { type: "ephemeral" } }],
    });
    expect(req.body.thinking).toBeUndefined(); // Opus 5.5 thinks adaptively; never send disabled/budget
    const tools = req.body.tools as Array<Record<string, unknown>>;
    expect(tools[0]).toMatchObject({ name: "delegate_task", eager_input_streaming: true });
    expect(tools[1]).toMatchObject({ type: "web_search_20260209", name: "web_search" });

    expect(r.stopReason).toBe("tool_use");
    expect(r.text).toBe("Let me delegate.");
    expect(r.toolCalls).toEqual([{ id: "toolu_1", name: "delegate_task", input: { agent_id: "researcher", title: "t", instructions: "i" } }]);
    expect(r.usage).toMatchObject({ inputTokens: 120, outputTokens: 45, cacheReadTokens: 30 });
    expect(r.servedModel).toBe("claude-opus-5-5");
    // Assistant turn is kept verbatim for append-only replay.
    expect((r.assistantMessage as { content: unknown[] }).content).toHaveLength(2);
  });

  it("omits the fallback beta for models without server-side fallback", async () => {
    let body: Record<string, unknown> = {};
    let beta: string | null = null;
    const fakeFetch = async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      beta = new Headers(init?.headers).get("anthropic-beta");
      return streamedMessage("claude-haiku-5-5", [{ type: "text", text: "hi" }], "end_turn");
    };
    const p = new AnthropicProvider("k", "default", { fetch: fakeFetch as typeof fetch, maxRetries: 0 });
    const r = await p.generate({ model: "claude-haiku-5-5", effort: "low", system: "s", messages: [p.userMessage("x")], tools: [], hostedTools: [], maxTokens: 2000 });
    expect(body.fallbacks).toBeUndefined();
    expect(beta).toBeNull();
    expect(body.tools).toBeUndefined();
    expect(r.stopReason).toBe("end_turn");
  });

  it("maps 401 to a non-retryable error", async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    const p = new AnthropicProvider("bad", "off", { fetch: fakeFetch as typeof fetch, maxRetries: 0 });
    await expect(
      p.generate({ model: "claude-opus-5-5", effort: "low", system: "s", messages: [p.userMessage("x")], tools: [], hostedTools: [], maxTokens: 100 }),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});
