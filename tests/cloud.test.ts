import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { loadConfig } from "../server/config.js";
import { MIGRATIONS, openDatabase } from "../server/db/database.js";
import { AnthropicProvider } from "../server/llm/anthropic.js";
import { runVerification } from "../server/engine/verify.js";
import { ScriptedProvider, say, testConfig } from "./helpers.js";

const dirs: string[] = [];
function tempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentopia-test-"));
  dirs.push(dir);
  return path.join(dir, "town.sqlite");
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** An API process and a worker process sharing one database file, as in docker-compose. */
function twoProcesses(provider = new ScriptedProvider([say("done")])) {
  const dbPath = tempDb();
  const api = createApp(testConfig({ dbPath, role: "api" }), { provider: new ScriptedProvider([]) });
  const worker = createApp(testConfig({ dbPath, role: "worker" }), { provider, startWorker: false, timings: { retryBaseMs: 1, statusDecayMs: 5 } });
  const request = (p: string, init: RequestInit = {}) =>
    api.api.request(p, { ...init, headers: { host: "127.0.0.1:8787", "content-type": "application/json", ...(init.headers ?? {}) } });
  return { api, worker, request };
}

describe("split API / worker deployment", () => {
  it("API-only processes never run tasks; a separate worker does", async () => {
    const { api, worker, request } = twoProcesses();
    expect(api.runner.running).toBe(false);
    const res = await request("/api/tasks", { method: "POST", body: JSON.stringify({ agentId: "manager", title: "Cross-process", instructions: "x" }) });
    const task = await res.json();
    await worker.runner.drain();
    expect(api.store.getTask(task.id)!.status).toBe("completed");
  });

  it("streams events written by the worker process to browsers connected to the API process", async () => {
    const { worker, request } = twoProcesses();
    const res = await request("/api/stream");
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    let pending: Promise<ReadableStreamReadResult<string>> | null = null;
    const until = async (needle: string) => {
      const deadline = Date.now() + 4000;
      while (!text.includes(needle) && Date.now() < deadline) {
        pending ??= reader.read();
        const r = await Promise.race([pending, new Promise<null>((ok) => setTimeout(() => ok(null), 200))]);
        if (r) {
          pending = null;
          text += r.value ?? "";
        }
      }
      return text.includes(needle);
    };
    expect(await until("event: hello")).toBe(true);
    worker.store.addEvent({ type: "system.notice", message: "hello from the worker process" });
    expect(await until("hello from the worker process")).toBe(true);
    await reader.cancel();
  });

  it("a cancel issued through the API reaches a task running in the worker", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { api, worker, request } = twoProcesses(new ScriptedProvider([async () => (await gate, { text: "too late" })]));
    const task = await (await request("/api/tasks", { method: "POST", body: JSON.stringify({ agentId: "manager", title: "Slow", instructions: "x" }) })).json();
    await worker.runner.tick();
    expect(worker.store.getTask(task.id)!.status).toBe("running");
    expect((await request(`/api/tasks/${task.id}/cancel`, { method: "POST", body: "{}" })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 2300)); // worker notices on its next lease heartbeat
    release();
    await worker.runner.drain();
    expect(api.store.getTask(task.id)!.status).toBe("cancelled");
    expect(api.store.getTask(task.id)!.output).toBeNull();
  });

  it("reports worker liveness and readiness", async () => {
    const { worker, request } = twoProcesses();
    const notReadyAll = createApp(testConfig({ dbPath: tempDb(), role: "all" }), { provider: new ScriptedProvider([]), startWorker: false });
    const r0 = await notReadyAll.api.request("/api/ready", { headers: { host: "127.0.0.1" } });
    expect(r0.status).toBe(503);
    worker.runner.start();
    const status = await (await request("/api/status")).json();
    expect(status.role).toBe("api");
    expect(status.workers.filter((w: { alive: boolean }) => w.alive)).toHaveLength(1);
    expect((await request("/api/ready")).status).toBe(200);
    await worker.runner.stop();
    expect((await (await request("/api/status")).json()).workers).toHaveLength(0);
  });

  it("re-queues work held by a crashed worker", async () => {
    const { api, worker } = twoProcesses();
    const t = api.store.createTask({ agentId: "manager", title: "Orphan", instructions: "x", createdBy: "user" });
    api.store.claimNextTask("crashed-worker", -1); // lease already expired: that worker died
    await worker.runner.drain();
    expect(api.store.getTask(t.id)!.status).toBe("completed");
  });
});

describe("upgrades & configuration", () => {
  it("migrates a Phase 1 database, mapping tool allowlists onto skills", () => {
    const dbPath = tempDb();
    const raw = new DatabaseSync(dbPath);
    raw.exec(MIGRATIONS[0] as string);
    raw.exec("PRAGMA user_version = 1");
    raw.exec(`INSERT INTO buildings (id, name, department, kind, slot) VALUES ('hall', 'Hall', 'Mgmt', 'hq', 'north')`);
    raw.exec(`INSERT INTO agents (id, name, role, system_prompt, model, tools, building_id, created_at, updated_at)
              VALUES ('old', 'Old', 'Researcher', 'p', 'claude-opus-5-5', '["web_search","delegate_task"]', 'hall', 'x', 'x')`);
    raw.close();
    const db = openDatabase(dbPath);
    const row = db.prepare("SELECT skills, archived FROM agents WHERE id = 'old'").get() as { skills: string; archived: number };
    expect(JSON.parse(row.skills).sort()).toEqual(["delegation", "research", "writing"]);
    expect(row.archived).toBe(0);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(MIGRATIONS.length);
    db.close();
  });

  it("reads secrets from *_FILE (Docker/Kubernetes secrets) and validates the role", () => {
    const dir = path.dirname(tempDb());
    const keyFile = path.join(dir, "key");
    fs.writeFileSync(keyFile, "sk-ant-from-file\n");
    const cfg = loadConfig({ ANTHROPIC_API_KEY_FILE: keyFile, AGENTOPIA_ROLE: "worker" } as NodeJS.ProcessEnv);
    expect(cfg.anthropicApiKey).toBe("sk-ant-from-file");
    expect(cfg.role).toBe("worker");
    expect(() => loadConfig({ AGENTOPIA_ROLE: "boss" } as NodeJS.ProcessEnv)).toThrow(/AGENTOPIA_ROLE/);
  });
});

describe("live verification logic (fake provider — proves pass/fail rules, not the API)", () => {
  it("passes only with evidence and a request id", async () => {
    const good = new ScriptedProvider([() => ({ text: "AGENTOPIA-OK" })]);
    const [ok] = await runVerification(good, { model: "claude-opus-5-5", checks: ["messages"] });
    expect(ok).toMatchObject({ ok: true, requestId: "req_scripted_1" });

    const noId = new ScriptedProvider([() => ({ text: "AGENTOPIA-OK", requestId: null })]);
    expect((await runVerification(noId, { model: "claude-opus-5-5", checks: ["messages"] }))[0].ok).toBe(false);

    const noSearch = new ScriptedProvider([() => ({ text: "https://python.org" })]); // claims a URL but ran no search
    expect((await runVerification(noSearch, { model: "claude-opus-5-5", checks: ["web_search"] }))[0].ok).toBe(false);

    const wrongHash = new ScriptedProvider([() => ({ text: "0".repeat(64), usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0, codeExecutions: 1 } })]);
    expect((await runVerification(wrongHash, { model: "claude-opus-5-5", checks: ["code_execution"] }))[0].ok).toBe(false);
  });

  it("refuses to 'verify' the simulator, and the connection-test endpoint records results", async () => {
    const { SimulatedProvider } = await import("../server/llm/simulated.js");
    await expect(runVerification(new SimulatedProvider(0), { model: "x" })).rejects.toThrow(/real provider/);

    const app = createApp(testConfig({ dbPath: tempDb(), anthropicApiKey: "sk-ant-test" }), { provider: new ScriptedProvider([() => ({ text: "AGENTOPIA-OK" })]), startWorker: false });
    const res = await app.api.request("/api/system/test-connection", { method: "POST", body: "{}", headers: { host: "127.0.0.1", "content-type": "application/json" } });
    expect(res.status).toBe(200);
    expect(app.store.latestVerifications()[0]).toMatchObject({ checkId: "messages", ok: true, source: "connection-test" });
  });
});

describe("Claude provider wire format (fake transport)", () => {
  it("sends the code-execution tool and captures the request id", async () => {
    let body: Record<string, unknown> = {};
    const fakeFetch = async (_u: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      const events = [
        ["message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } }],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }],
        ["message_stop", { type: "message_stop" }],
      ];
      return new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(""), {
        status: 200,
        headers: { "content-type": "text/event-stream", "request-id": "req_wire_123" },
      });
    };
    const p = new AnthropicProvider("k", "default", { fetch: fakeFetch as typeof fetch, maxRetries: 0 });
    const r = await p.generate({ model: "claude-opus-5-5", effort: "low", system: "s", messages: [p.userMessage("x")], tools: [], hostedTools: ["code_execution"], maxTokens: 1000 });
    expect((body.tools as { type: string }[]).map((t) => t.type)).toEqual(["code_execution_20260521"]);
    expect(r.requestId).toBe("req_wire_123");
  });
});
