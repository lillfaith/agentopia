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
  const started = Date.now();
  let done: any = null;
  while (Date.now() - started < 180_000) {
    const t = (await alice(`/api/tasks/${task.body.id}`)).body.task;
    if (["completed", "failed", "cancelled"].includes(t.status)) {
      done = t;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
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
    snap.projects.some((p: any) => p.id === project.body.id) && persisted?.status === "completed" && persisted?.output === output,
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
