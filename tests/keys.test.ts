import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Vault } from "../server/secrets/vault.js";
import { OpenAIProvider } from "../server/llm/openai.js";
import { GeminiProvider } from "../server/llm/gemini.js";
import { githubApi } from "../server/agents/github.js";
import type { KeyCheckers } from "../server/llm/keys.js";
import type { LLMProvider } from "../server/llm/provider.js";
import { ScriptedProvider, callTool, harness, say } from "./helpers.js";

const OPENAI_KEY = "sk-test-openai-0123456789abcdefXYZ1";
const checkers: KeyCheckers = {
  anthropic: async (s) => (s.includes("bad") ? Promise.reject(Object.assign(new Error("no"), { status: 401 })) : ["claude-haiku-5-5", "claude-sonnet-5-5"]),
  openai: async (s) => (s.includes("bad") ? Promise.reject(Object.assign(new Error("no"), { status: 401 })) : ["gpt-5", "gpt-5-mini"]),
  gemini: async () => ["gemini-3-pro"],
  github: async () => "octocat",
};

describe("key vault", () => {
  it("encrypts with AES-GCM bound to one record and rejects tampering", () => {
    const v = Vault.fromKey(Buffer.alloc(32, 7));
    const sealed = v.encrypt("sk-secret", "cred-1");
    expect(sealed).not.toContain("sk-secret");
    expect(v.decrypt(sealed, "cred-1")).toBe("sk-secret");
    expect(() => v.decrypt(sealed, "cred-2")).toThrow();
    const raw = Buffer.from(sealed.slice(3), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => v.decrypt(`v1:${raw.toString("base64")}`, "cred-1")).toThrow();
    expect(() => Vault.fromKey(Buffer.alloc(16))).toThrow();
  });

  it("uses AGENTOPIA_SECRETS_KEY, or creates one key file and reuses it", () => {
    const hex = "ab".repeat(32);
    expect(Vault.open({ secretsKey: hex, keyFile: null }).decrypt(Vault.open({ secretsKey: hex, keyFile: null }).encrypt("x", "a"), "a")).toBe("x");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
    const file = path.join(dir, "secrets.key");
    const first = Vault.open({ secretsKey: null, keyFile: file });
    expect((fs.statSync(file).mode & 0o777).toString(8)).toBe("600");
    expect(Vault.open({ secretsKey: null, keyFile: file }).decrypt(first.encrypt("y", "b"), "b")).toBe("y");
    fs.rmSync(dir, { recursive: true, force: true });
    expect(() => Vault.open({ secretsKey: "too-short", keyFile: null })).toThrow(/32 bytes/);
  });
});

describe("owners' own API keys", () => {
  const make = (extra: Parameters<typeof harness>[1] = {}) => harnessWith(new ScriptedProvider([]), extra);

  it("checks a key before storing it, never sends it back, and stores it encrypted", async () => {
    const h = make();
    const bad = await h.request("/api/credentials", { method: "POST", body: JSON.stringify({ service: "openai", label: "Work", secret: "sk-bad-key-000000000000" }) });
    expect(bad.status).toBe(400);
    expect(h.store.listCredentials()).toHaveLength(0);

    const res = await h.request("/api/credentials", { method: "POST", body: JSON.stringify({ service: "openai", label: "Work", secret: OPENAI_KEY }) });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(OPENAI_KEY);
    const cred = JSON.parse(text);
    expect(cred).toMatchObject({ service: "openai", label: "Work", status: "ok", hint: "sk-tes…XYZ1", models: ["gpt-5", "gpt-5-mini"] });
    expect(await (await h.request("/api/credentials")).text()).not.toContain(OPENAI_KEY);
    const row = h.store.db.prepare("SELECT secret FROM credentials").get() as { secret: string };
    expect(row.secret.startsWith("v1:")).toBe(true);
    expect(row.secret).not.toContain(OPENAI_KEY);
    expect(h.store.credentialSecret(cred.id)).toBe(OPENAI_KEY);
    expect(JSON.stringify(h.store.listEvents({}))).not.toContain(OPENAI_KEY);
  });

  it("hires villagers on Claude, OpenAI or Gemini only with a matching key", async () => {
    const h = make({ allowedModels: ["claude-haiku-5-5"] });
    const openai = h.store.addCredential({ service: "openai", label: "Work", secret: OPENAI_KEY });
    const claude = h.store.addCredential({ service: "anthropic", label: "Mine", secret: "sk-ant-mine-0000000000000" });
    const base = { name: "Ada", role: "Analyst", systemPrompt: "You analyse.", skills: ["research"], buildingId: "observatory" };
    const hire = (b: Record<string, unknown>) => h.request("/api/agents", { method: "POST", body: JSON.stringify({ ...base, ...b }) });

    expect((await hire({ provider: "openai", model: "gpt-5" })).status).toBe(400); // no key
    expect((await hire({ provider: "gemini", credentialId: openai.id, model: "gemini-3-pro" })).status).toBe(400); // wrong service
    expect((await hire({ provider: "openai", credentialId: openai.id, model: "claude-haiku-5-5" })).status).toBe(400);
    expect((await hire({ model: "claude-sonnet-5-5" })).status).toBe(403); // Agentopia's key: plan models only
    const own = await hire({ name: "Bea", provider: "anthropic", credentialId: claude.id, model: "claude-sonnet-5-5" });
    expect(own.status).toBe(201); // own key: any Claude model
    const gpt = await hire({ name: "Cy", provider: "openai", credentialId: openai.id, model: "gpt-5", customPrices: { inputPerMTok: 1.25, outputPerMTok: 10 } });
    expect(gpt.status).toBe(201);
    expect(await gpt.json()).toMatchObject({ provider: "openai", credentialId: openai.id, model: "gpt-5", customPrices: { inputPerMTok: 1.25, outputPerMTok: 10 } });

    // Removing the key sends its villagers back to Agentopia's Claude.
    const del = await h.request(`/api/credentials/${openai.id}`, { method: "DELETE" });
    expect(await del.json()).toMatchObject({ ok: true, agents: ["cy"] });
    expect(h.store.getAgent("cy")).toMatchObject({ provider: "anthropic", credentialId: null, model: h.config.defaultModel });
  });

  it("runs a villager on its own key, outside the town's limits, but within its own cap", async () => {
    const platform = new ScriptedProvider([say("platform answer")]);
    const ownProvider = new ScriptedProvider([say("own-key answer")]);
    const h = harnessWith(platform, { dailyBudgetUsd: 0.05 }, { providerFactory: () => ownProvider });
    const cred = h.store.addCredential({ service: "openai", label: "Work", secret: OPENAI_KEY });
    h.store.updateAgent("researcher", { provider: "openai", credentialId: cred.id, model: "gpt-5", customPrices: { inputPerMTok: 1, outputPerMTok: 8 } });
    // The town's daily budget is already used up on Agentopia's key…
    h.store.recordUsage({ agentId: "manager", taskId: null, model: "claude-haiku-5-5", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0, webFetchRequests: 0, codeExecutions: 0, costUsd: 0.06, simulated: false, requestId: "r", requestedModel: "claude-haiku-5-5" });
    const mine = h.store.createTask({ agentId: "researcher", title: "Own", instructions: "x", createdBy: "user" });
    const theirs = h.store.createTask({ agentId: "copywriter", title: "Platform", instructions: "x", createdBy: "user" });
    await h.runner.drain();
    // …so the Claude villager waits, while the own-key villager still works.
    expect(h.store.getTask(theirs.id)!.status).toBe("queued");
    expect(h.store.getTask(mine.id)).toMatchObject({ status: "completed", output: "own-key answer" });
    expect(ownProvider.calls[0].model).toBe("gpt-5");
    const rows = h.store.taskUsage(mine.id);
    expect(rows[0]).toMatchObject({ billing: "own", costUsd: (1000 * 1 + 500 * 8) / 1e6 });
    expect(h.store.spendSince("2000-01-01")).toBeCloseTo(0.06, 6); // town spend: Agentopia's key only
    expect(h.store.ownKeySpendSince("2000-01-01")).toBeCloseTo(0.005, 6);

    // The villager's own daily cap still applies to its own key.
    h.store.updateAgent("researcher", { dailyBudgetUsd: 0.004 });
    const capped = h.store.createTask({ agentId: "researcher", title: "Again", instructions: "x", createdBy: "user" });
    await h.runner.drain();
    expect(h.store.getTask(capped.id)!.status).toBe("queued");
  });

  it("fails clearly when a villager's key is missing, and restarts a conversation after a provider switch", async () => {
    const platform = new ScriptedProvider([say("v1 on Claude")]);
    const ownProvider = new ScriptedProvider([say("v2 on GPT")]);
    const h = harnessWith(platform, {}, { providerFactory: () => ownProvider });
    const task = h.store.createTask({ agentId: "researcher", title: "Scan", instructions: "Find brands.", createdBy: "user" });
    await h.runner.drain();
    const cred = h.store.addCredential({ service: "openai", label: "Work", secret: OPENAI_KEY });
    h.store.updateAgent("researcher", { provider: "openai", credentialId: cred.id, model: "gpt-5" });
    await h.request(`/api/tasks/${task.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Shorter please." }) });
    await h.runner.drain();
    // The Claude transcript can't be sent to OpenAI: the new provider gets the conversation as text.
    const first = ownProvider.calls[0].messages as { content: string }[];
    expect(first).toHaveLength(1);
    expect(first[0].content).toContain("## The conversation so far");
    expect(first[0].content).toContain("Shorter please.");
    expect(h.store.getTask(task.id)!.output).toBe("v2 on GPT");

    h.store.updateAgent("copywriter", { provider: "gemini", credentialId: null });
    const orphan = h.store.createTask({ agentId: "copywriter", title: "x", instructions: "x", createdBy: "user" });
    await h.runner.drain();
    expect(h.store.getTask(orphan.id)).toMatchObject({ status: "failed" });
    expect(h.store.getTask(orphan.id)!.lastError).toMatch(/has no API key/);
  });
});

describe("OpenAI provider", () => {
  it("sends a stateless Responses request and maps tools, sources and cached tokens", async () => {
    const seen: Record<string, any>[] = [];
    const body = {
      id: "resp_1",
      object: "response",
      created_at: 1,
      model: "gpt-5-2026",
      status: "completed",
      output: [
        { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "enc" },
        { type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Searching for prices first.", annotations: [] }] },
        { type: "web_search_call", id: "ws1", status: "completed", action: { type: "search", query: "protein bar prices" } },
        { type: "web_search_call", id: "ws2", status: "completed", action: { type: "open_page", url: "https://example.com/bars" } },
        {
          type: "message",
          id: "m2",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "ALOHA costs $2.", annotations: [{ type: "url_citation", url: "https://example.com/bars", title: "Bars", start_index: 0, end_index: 5 }] }],
        },
      ],
      usage: { input_tokens: 1200, input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 0 }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 120 }, total_tokens: 1500 },
    };
    const fakeFetch = async (_url: unknown, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_oa_1" } });
    };
    const p = new OpenAIProvider("sk-x", { fetch: fakeFetch as typeof fetch, maxRetries: 0 });
    const r = await p.generate({
      model: "gpt-5",
      effort: "medium",
      system: "You are Pip.",
      messages: [p.userMessage("Find prices"), { bundle: [{ type: "function_call_output", call_id: "c0", output: "ok" }] }],
      tools: [{ name: "remember", description: "d", inputSchema: { type: "object", properties: {} } }],
      hostedTools: ["web_search", "web_fetch"],
      maxTokens: 8000,
    });
    expect(seen[0]).toMatchObject({
      model: "gpt-5",
      instructions: "You are Pip.",
      store: false,
      max_output_tokens: 8000,
      reasoning: { effort: "medium" },
      include: ["reasoning.encrypted_content"],
      tools: [{ type: "function", name: "remember", strict: false }, { type: "web_search" }],
      input: [{ role: "user", content: "Find prices", type: "message" }, { type: "function_call_output", call_id: "c0", output: "ok" }],
    });
    expect(r.text).toBe("ALOHA costs $2.\n\n**Sources**\n- [Bars](https://example.com/bars)");
    expect(r.notes).toEqual(["Searching for prices first."]);
    expect(r.hostedActivity).toEqual(["Web search: “protein bar prices”", "Read page: https://example.com/bars"]);
    expect(r.usage).toMatchObject({ inputTokens: 200, cacheReadTokens: 1000, outputTokens: 300, webSearchRequests: 1, webFetchRequests: 1 });
    expect(r).toMatchObject({ stopReason: "end_turn", thinkingTokens: 120, servedModel: "gpt-5-2026", requestId: "req_oa_1" });
    // The whole turn (incl. encrypted reasoning) is kept to replay next time.
    expect((r.assistantMessage as { bundle: unknown[] }).bundle).toHaveLength(5);
  });

  it("turns function calls into tool calls and the write-up into tool_choice none", async () => {
    const seen: Record<string, any>[] = [];
    const out = { id: "r", object: "response", created_at: 1, model: "gpt-4.1", status: "completed", output: [{ type: "function_call", call_id: "call_9", name: "remember", arguments: '{"note":"hi"}' }], usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 } } };
    const p = new OpenAIProvider("sk-x", { fetch: (async (_u: unknown, i?: RequestInit) => (seen.push(JSON.parse(String(i?.body))), new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } }))) as typeof fetch, maxRetries: 0 });
    const r = await p.generate({ model: "gpt-4.1", effort: "high", system: "s", messages: [p.userMessage("x")], tools: [{ name: "remember", description: "d", inputSchema: {} }], hostedTools: [], maxTokens: 100, noTools: true });
    expect(r.toolCalls).toEqual([{ id: "call_9", name: "remember", input: { note: "hi" } }]);
    expect(r.stopReason).toBe("tool_use");
    expect(seen[0].tool_choice).toBe("none");
    expect(seen[0].reasoning).toBeUndefined(); // not a reasoning model
  });
});

describe("Gemini provider", () => {
  it("sends system, function and Google Search tools, and maps the reply", async () => {
    const seen: { url: string; body: Record<string, any> }[] = [];
    const reply = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { text: "Let me check.", thoughtSignature: "sig" },
              { functionCall: { name: "remember", args: { note: "x" } } },
            ],
          },
          finishReason: "STOP",
          groundingMetadata: { webSearchQueries: ["protein bars"], groundingChunks: [{ web: { uri: "https://example.com/g", title: "example.com" } }] },
        },
      ],
      usageMetadata: { promptTokenCount: 900, cachedContentTokenCount: 400, candidatesTokenCount: 50, thoughtsTokenCount: 30 },
      modelVersion: "gemini-3-pro",
      responseId: "gem_1",
    };
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
    };
    const p = new GeminiProvider("AIza-test", { fetch: fakeFetch as typeof fetch });
    const r = await p.generate({
      model: "gemini-3-pro",
      effort: "low",
      system: "You are Pip.",
      messages: [p.userMessage("Find prices")],
      tools: [{ name: "remember", description: "d", inputSchema: { type: "object", properties: { note: { type: "string" } } } }],
      hostedTools: ["web_search"],
      maxTokens: 4000,
    });
    expect(seen[0].url).toContain("gemini-3-pro:generateContent");
    const b = seen[0].body;
    expect(JSON.stringify(b.systemInstruction)).toContain("You are Pip.");
    expect(b.tools).toEqual([{ functionDeclarations: [{ name: "remember", description: "d", parametersJsonSchema: { type: "object", properties: { note: { type: "string" } } } }] }, { googleSearch: {} }]);
    expect(b.toolConfig).toMatchObject({ includeServerSideToolInvocations: true });
    expect(b.generationConfig).toMatchObject({ maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: "LOW" } });
    expect(r.stopReason).toBe("tool_use");
    expect(r.toolCalls[0]).toMatchObject({ name: "remember", input: { note: "x" } });
    expect(r.toolCalls[0].id.startsWith("remember|")).toBe(true);
    expect(r.notes).toEqual(["Let me check."]);
    expect(r.usage).toMatchObject({ inputTokens: 500, cacheReadTokens: 400, outputTokens: 80, webSearchRequests: 1 });
    expect(r).toMatchObject({ thinkingTokens: 30, requestId: "gem_1", hostedActivity: ["Web search: “protein bars”"] });
    // The stored turn keeps the thought signature and gets the generated call id, to match the response.
    const parts = (r.assistantMessage as { parts: any[] }).parts;
    expect(parts[0].thoughtSignature).toBe("sig");
    expect(r.toolCalls[0].id).toBe(`remember|${parts[1].functionCall.id}`);
    const results = p.toolResultsMessage([{ toolCallId: r.toolCalls[0].id, content: "Saved." }]) as { parts: any[] };
    expect(results.parts[0].functionResponse).toEqual({ id: parts[1].functionCall.id, name: "remember", response: { output: "Saved." } });
  });
});

describe("GitHub skill", () => {
  it("reads with the villager's token and only writes after the owner approves", async () => {
    const calls: { method: string; url: string; auth: string | null; body?: any }[] = [];
    const prev = githubApi.fetch;
    githubApi.fetch = async (input: any, init?: any) => {
      const url = String(input);
      calls.push({ method: init?.method ?? "GET", url, auth: new Headers(init?.headers).get("authorization"), body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.endsWith("/contents/README.md")) return new Response(JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from("# Hello").toString("base64") }), { status: 200 });
      if (url.endsWith("/issues") && init?.method === "POST") return new Response(JSON.stringify({ number: 7, html_url: "https://github.com/o/r/issues/7" }), { status: 201 });
      return new Response("{}", { status: 404 });
    };
    try {
      const provider = new ScriptedProvider([
        callTool("github_read_file", { repo: "o/r", path: "README.md" }, "t1"),
        callTool("github_create_issue", { repo: "o/r", title: "Docs typo", body: "Fix it" }, "t2"),
        say("Opened the issue."),
      ]);
      const h = harnessWith(provider);
      const gh = h.store.addCredential({ service: "github", label: "Mine", secret: "ghp_testtoken0000000000000000" });
      h.store.updateAgent("researcher", { skills: ["github"], githubCredentialId: gh.id });
      const task = h.store.createTask({ agentId: "researcher", title: "Fix docs", instructions: "x", createdBy: "user" });
      await h.runner.drain();
      expect(calls[0]).toMatchObject({ method: "GET", url: "https://api.github.com/repos/o/r/contents/README.md", auth: "Bearer ghp_testtoken0000000000000000" });
      expect(JSON.stringify(provider.calls[1].messages)).toContain("# Hello");
      // The write waits for approval: nothing posted yet.
      expect(h.store.getTask(task.id)!.status).toBe("waiting_approval");
      expect(calls.some((c) => c.method === "POST")).toBe(false);
      const approval = h.store.listApprovals({ taskId: task.id })[0];
      expect(approval.summary).toBe("Open issue in o/r: “Docs typo”");
      expect((await h.request(`/api/approvals/${approval.id}/decide`, { method: "POST", body: JSON.stringify({ approve: true }) })).status).toBe(200);
      await h.runner.drain();
      expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: "https://api.github.com/repos/o/r/issues", body: { title: "Docs typo", body: "Fix it" } });
      expect(h.store.getTask(task.id)).toMatchObject({ status: "completed", output: "Opened the issue." });
    } finally {
      githubApi.fetch = prev;
    }
  });
});

/** harness() plus the app options this file needs (provider factory, offline key checks). */
function harnessWith(provider: LLMProvider, overrides: Parameters<typeof harness>[1] = {}, appOpts: Record<string, unknown> = {}) {
  return harness(provider, overrides, { keyCheckers: checkers, ...appOpts } as never);
}
