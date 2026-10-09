/**
 * npm run e2e:live — the SaaS vertical slice against the REAL Claude API, over real HTTP.
 *
 *   sign up → create a project → assign a task → a villager performs it in the
 *   background → the output appears → it is still there after a full server restart.
 *
 * Also checks that a second user can't see the first user's work. Uses the cheapest
 * model and a one-paragraph task (well under $0.05). Never prints the API key.
 * `npm run e2e:live -- --simulate` runs the same flow offline (labelled simulated output).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { loadConfig } from "../server/config.js";
import { createSaasApp } from "../server/saas/server.js";

const simulate = process.argv.includes("--simulate");
const MODEL = "claude-haiku-5-5";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentopia-e2e-"));
const config = loadConfig({
  ...process.env,
  AGENTOPIA_MODE: "saas",
  AGENTOPIA_DATA_DIR: dataDir,
  AGENTOPIA_SIMULATION: simulate ? "true" : "false",
  ANTHROPIC_API_KEY: simulate ? "" : process.env.ANTHROPIC_API_KEY,
  HOST: "127.0.0.1",
  PORT: "0",
} as NodeJS.ProcessEnv);
if (!simulate && !config.anthropicApiKey) {
  console.error("✗ ANTHROPIC_API_KEY is not set (use --simulate for an offline run).");
  process.exit(1);
}

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function boot() {
  const saas = createSaasApp(config, { pollMs: 500 });
  const server = serve({ fetch: saas.app.fetch, hostname: "127.0.0.1", port: 0 });
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    async stop() {
      server.close();
      await saas.stop();
    },
  };
}

/** A browser session: same-origin JSON requests that keep the session cookie. */
function browser(base: string) {
  let cookie = "";
  return async <T = any>(p: string, method = "GET", body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await fetch(base + p, {
      method,
      headers: { "content-type": "application/json", origin: base, ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, body: (await res.json()) as T };
  };
}

const email = `e2e-${Date.now()}@example.com`;
const password = "e2e correct horse battery";
let exitCode = 1;
let first = await boot();
try {
  const alice = browser(first.base);
  const signup = await alice("/api/auth/signup", "POST", { email, password });
  check("sign up", signup.status === 201, `plan ${signup.body.plan?.label}`);

  const project = await alice("/api/projects", "POST", { title: "Lavender latte launch", goal: "Get remote workers into the café on weekday afternoons" });
  check("create project", project.status === 201);

  const model = await alice("/api/agents/copywriter", "PATCH", { model: MODEL, effort: "low" });
  check(`villager uses ${MODEL}`, model.status === 200 && model.body.model === MODEL);

  const task = await alice("/api/tasks", "POST", {
    agentId: "copywriter",
    title: "Tagline options",
    instructions: "Write exactly three short tagline options for a lavender oat-milk latte. Reply with a numbered list only.",
    projectId: project.body.id,
  });
  check("assign task in project", task.status === 201 && task.body.projectId === project.body.id);

  // The worker pool runs it in the background; the "browser" only polls.
  const waitDone = async (id: string) => {
    const t0 = Date.now();
    while (Date.now() - t0 < 180_000) {
      const t = (await alice(`/api/tasks/${id}`)).body.task;
      if (["completed", "failed", "cancelled"].includes(t.status)) return t;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return null;
  };
  const started = Date.now();
  const done: any = await waitDone(task.body.id);
  check("villager finished the task in the background", done?.status === "completed", done ? `${done.status} in ${Math.round((Date.now() - started) / 1000)}s${done.lastError ? `: ${done.lastError}` : ""}` : "timed out");
  const output: string = done?.output ?? "";
  check("real output appeared", output.trim().length > 20 && (simulate || !output.includes("SIMULATED")), JSON.stringify(output.slice(0, 160)));
  if (!simulate) {
    check(
      "executed by the live Claude API",
      done?.execution?.mode === "live" && /^req_/.test(done?.execution?.lastRequestId ?? ""),
      `${done?.execution?.calls} call(s), ${done?.execution?.models?.join(",")}, ~$${Number(done?.execution?.costUsd ?? 0).toFixed(4)}, request ${done?.execution?.lastRequestId}`,
    );
  }

  // Chat: reply to the finished task; the villager answers in the same conversation.
  const reply = await alice(`/api/tasks/${task.body.id}/messages`, "POST", { text: "Pick the best one of those three and reply with only that tagline." });
  const revised: any = reply.status === 202 ? await waitDone(task.body.id) : null;
  const thread = (await alice(`/api/tasks/${task.body.id}/messages`)).body as { role: string; content: string }[];
  const finalOutput: string = revised?.output ?? output;
  check(
    "reply to the villager and get a revised answer",
    revised?.status === "completed" && finalOutput !== output && finalOutput.trim().length > 3 && (simulate || finalOutput.length < output.length) && thread.length === 4,
    `${thread.map((m) => m.role).join(" → ")}: ${JSON.stringify(finalOutput.slice(0, 120))}`,
  );
  const chat = await alice("/api/chats", "POST", { agentId: "copywriter", text: "In one short sentence, what makes a tagline memorable?" });
  const chatDone: any = chat.status === 201 ? await waitDone(chat.body.id) : null;
  check("start a free-form chat", chatDone?.status === "completed" && chatDone.kind === "chat" && (chatDone.output ?? "").trim().length > 10, JSON.stringify((chatDone?.output ?? chatDone?.lastError ?? "").slice(0, 120)));

  // Own key: the owner adds their own Claude key; work on it is billed to them, not the plan.
  if (!simulate) {
    const key = await alice("/api/credentials", "POST", { service: "anthropic", label: "e2e own key", secret: process.env.ANTHROPIC_API_KEY });
    check("add own Claude key (checked, never echoed)", key.status === 201 && key.body.status === "ok" && !JSON.stringify(key.body).includes(process.env.ANTHROPIC_API_KEY!), key.body.statusDetail ?? key.body.error ?? "");
    const own = await alice("/api/agents/copywriter", "PATCH", { provider: "anthropic", credentialId: key.body.id, model: MODEL });
    const planBefore = (await alice("/api/status")).body.spent.todayUsd;
    const ownTask = await alice("/api/tasks", "POST", { agentId: "copywriter", title: "Own-key tagline", instructions: "Reply with one short tagline for a lavender latte. Nothing else." });
    const ownDone: any = own.status === 200 && ownTask.status === 201 ? await waitDone(ownTask.body.id) : null;
    const ownUsage = ownDone ? (await alice(`/api/tasks/${ownTask.body.id}/usage`)).body : null;
    const planAfter = (await alice("/api/status")).body.spent.todayUsd;
    check(
      "villager works on the owner's own key, outside the plan",
      ownDone?.status === "completed" && ownUsage?.calls.length > 0 && ownUsage.calls.every((x: any) => x.billing === "own") && planAfter === planBefore,
      `${ownDone?.status ?? "not run"}${ownDone?.lastError ? `: ${ownDone.lastError}` : ""} · plan spend ${planBefore} → ${planAfter}`,
    );
    await alice("/api/agents/copywriter", "PATCH", { provider: "anthropic", credentialId: null, model: MODEL });
  }

  const bob = browser(first.base);
  await bob("/api/auth/signup", "POST", { email: `other-${email}`, password });
  const peek = await bob(`/api/tasks/${task.body.id}`);
  const bobSnap = await bob("/api/snapshot");
  check("another user cannot see it", peek.status === 404 && bobSnap.body.projects.length === 0 && !bobSnap.body.tasks.some((t: any) => t.id === task.body.id));

  // Full restart on the same data directory, then sign in again.
  await first.stop();
  first = await boot();
  const again = browser(first.base);
  const login = await again("/api/auth/login", "POST", { email, password });
  check("sign in after restart", login.status === 200);
  const snap = (await again("/api/snapshot")).body;
  const persisted = snap.tasks.find((t: any) => t.id === task.body.id);
  check(
    "results persist after refresh",
    snap.projects.some((p: any) => p.id === project.body.id) && persisted?.status === "completed" && persisted?.output === finalOutput,
  );
  exitCode = results.every((r) => r.ok) ? 0 : 1;
} catch (err) {
  console.error("✗ e2e crashed:", err instanceof Error ? err.message : err);
} finally {
  await first.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed${simulate ? " (SIMULATED — no AI was called)" : ""}`);
process.exit(exitCode);
