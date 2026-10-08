import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Project, Task, TownSnapshot } from "../shared/types.js";
import { createSaasApp, type SaasOptions } from "../server/saas/server.js";
import { ScriptedProvider, say, testConfig } from "./helpers.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentopia-saas-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function saas(provider: ScriptedProvider, dataDir = tmpDir(), opts: SaasOptions = {}) {
  const config = testConfig({ mode: "saas", dataDir, trustProxy: true, workerPollMs: 20, minScheduleIntervalMinutes: 1 });
  const s = createSaasApp(config, { provider, startWorker: false, timings: { retryBaseMs: 1, statusDecayMs: 5 }, pollMs: 20, activityGraceMs: 20, ...opts });
  cleanups.push(() => s.stop());
  return { ...s, config, dataDir };
}

/** A browser: keeps the session cookie between requests. */
function client(app: ReturnType<typeof saas>["app"], ip = "10.0.0.1") {
  let cookie = "";
  const request = async (p: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await app.request(p, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      headers: { host: "app.test", "content-type": "application/json", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}), ...init.headers },
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    return res;
  };
  return {
    request,
    json: async <T = any>(p: string, init?: Parameters<typeof request>[1]) => {
      const res = await request(p, init);
      return { status: res.status, body: (await res.json()) as T };
    },
    get cookie() {
      return cookie;
    },
  };
}

async function until<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timed out");
}

describe("SaaS accounts", () => {
  it("requires a session for town routes and signs users up and in", async () => {
    const s = saas(new ScriptedProvider([]));
    const browser = client(s.app);
    const anon = await browser.json("/api/snapshot");
    expect(anon.status).toBe(401);
    expect(anon.body.auth).toBe("session");

    const weak = await browser.json("/api/auth/signup", { body: { email: "a@example.com", password: "short" } });
    expect(weak.status).toBe(400);

    const up = await browser.json("/api/auth/signup", { body: { email: "Ada@Example.com", password: "correct horse battery" } });
    expect(up.status).toBe(201);
    expect(up.body.user.email).toBe("ada@example.com");
    expect(up.body.plan.id).toBe("trial");
    expect(browser.cookie).toMatch(/^agentopia_session=/);

    const snap = await browser.json<TownSnapshot>("/api/snapshot");
    expect(snap.status).toBe(200);
    expect(snap.body.agents.length).toBeGreaterThan(0);
    expect(snap.body.projects).toEqual([]);
    // SaaS users never see operator details.
    expect(snap.body.status.workers).toEqual([]);

    const dup = await client(s.app).json("/api/auth/signup", { body: { email: "ada@example.com", password: "another long password" } });
    expect(dup.status).toBe(409);

    await browser.json("/api/auth/logout", { body: {} });
    expect((await browser.json("/api/snapshot")).status).toBe(401);

    const bad = await browser.json("/api/auth/login", { body: { email: "ada@example.com", password: "wrong password!!" } });
    expect(bad.status).toBe(401);
    const good = await browser.json("/api/auth/login", { body: { email: "ADA@example.com", password: "correct horse battery" } });
    expect(good.status).toBe(200);
    expect((await browser.json("/api/snapshot")).status).toBe(200);

    const audit = await browser.json<{ action: string }[]>("/api/account/audit");
    expect(audit.body.map((a) => a.action)).toEqual(["account.login", "account.login_failed", "account.logout", "account.signup"]);
  });

  it("stores only password and session hashes", async () => {
    const s = saas(new ScriptedProvider([]));
    const browser = client(s.app);
    await browser.json("/api/auth/signup", { body: { email: "b@example.com", password: "correct horse battery" } });
    const user = s.accounts.db.prepare("SELECT password_hash FROM users").get() as { password_hash: string };
    expect(user.password_hash).toMatch(/^scrypt\$/);
    expect(user.password_hash).not.toContain("correct horse");
    const token = browser.cookie.split("=")[1];
    const session = s.accounts.db.prepare("SELECT token_hash FROM sessions").get() as { token_hash: string };
    expect(session.token_hash).not.toBe(token);
  });

  it("locks an email after repeated failed sign-ins", async () => {
    const s = saas(new ScriptedProvider([]));
    await client(s.app).json("/api/auth/signup", { body: { email: "c@example.com", password: "correct horse battery" } });
    const attacker = client(s.app, "10.9.9.9");
    for (let i = 0; i < 8; i++) expect((await attacker.json("/api/auth/login", { body: { email: "c@example.com", password: `guess-${i}-xxxxx` } })).status).toBe(401);
    const locked = await attacker.json("/api/auth/login", { body: { email: "c@example.com", password: "correct horse battery" } });
    expect(locked.status).toBe(429);
  });

  it("rejects cross-site and non-JSON mutations", async () => {
    const s = saas(new ScriptedProvider([]));
    const browser = client(s.app);
    await browser.json("/api/auth/signup", { body: { email: "d@example.com", password: "correct horse battery" } });
    const cross = await browser.json("/api/projects", { body: { title: "x" }, headers: { origin: "https://evil.test" } });
    expect(cross.status).toBe(403);
    const form = await browser.request("/api/projects", { body: { title: "x" }, headers: { "content-type": "text/plain" } });
    expect(form.status).toBe(415);
    const ok = await browser.json("/api/projects", { body: { title: "x" }, headers: { origin: "http://app.test" } });
    expect(ok.status).toBe(201);
  });

  it("keeps operator-only endpoints out of reach", async () => {
    const s = saas(new ScriptedProvider([]));
    const browser = client(s.app);
    await browser.json("/api/auth/signup", { body: { email: "e@example.com", password: "correct horse battery" } });
    expect((await browser.json("/api/system/test-connection", { body: {} })).status).toBe(404);
  });
});

describe("SaaS isolation", () => {
  it("gives every user a private town that others cannot read or change", async () => {
    const s = saas(new ScriptedProvider([]));
    const alice = client(s.app, "10.0.0.2");
    const bob = client(s.app, "10.0.0.3");
    await alice.json("/api/auth/signup", { body: { email: "alice@example.com", password: "alice password 123" } });
    await bob.json("/api/auth/signup", { body: { email: "bob@example.com", password: "bob password 12345" } });

    const project = (await alice.json<Project>("/api/projects", { body: { title: "Alice's launch", goal: "Secret plans" } })).body;
    const task = (await alice.json<Task>("/api/tasks", { body: { agentId: "researcher", title: "Private research", instructions: "Look into it", projectId: project.id } })).body;
    await alice.json("/api/settings", { method: "PATCH", body: { townName: "Aliceville" } });

    const bobSnap = (await bob.json<TownSnapshot>("/api/snapshot")).body;
    expect(bobSnap.projects).toEqual([]);
    expect(bobSnap.tasks.find((t) => t.id === task.id)).toBeUndefined();
    expect(bobSnap.settings.townName).not.toBe("Aliceville");
    expect(JSON.stringify(bobSnap)).not.toContain("Secret plans");

    // Knowing the ids is not enough.
    expect((await bob.json(`/api/tasks/${task.id}`)).status).toBe(404);
    expect((await bob.json(`/api/projects/${project.id}`)).status).toBe(404);
    expect((await bob.json(`/api/projects/${project.id}`, { method: "PATCH", body: { title: "pwned" } })).status).toBe(404);
    expect((await bob.json(`/api/tasks/${task.id}/cancel`, { body: {} })).status).toBe(409);
    expect((await bob.json(`/api/events?taskId=${task.id}`)).body).toEqual([]);
    // Bob cannot attach his task to Alice's project either.
    expect((await bob.json("/api/tasks", { body: { agentId: "researcher", title: "t", instructions: "i", projectId: project.id } })).status).toBe(400);

    const aliceTask = (await alice.json<{ task: Task }>(`/api/tasks/${task.id}`)).body.task;
    expect(aliceTask.status).toBe("queued");
    expect((await alice.json<Project>(`/api/projects/${project.id}`)).body).toMatchObject({ project: { title: "Alice's launch" } });

    // Separate database files on disk.
    const files = fs.readdirSync(path.join(s.dataDir, "towns")).filter((f) => f.endsWith(".sqlite"));
    expect(files).toHaveLength(2);
  });

  it("ignores a forged or stale session cookie", async () => {
    const s = saas(new ScriptedProvider([]));
    const res = await s.app.request("/api/snapshot", { headers: { host: "app.test", cookie: "agentopia_session=forged-token" } });
    expect(res.status).toBe(401);
  });
});

describe("SaaS vertical slice", () => {
  it("log in → create project → assign task → runs in the background → output persists after restart", async () => {
    const provider = new ScriptedProvider([say("## Findings\nThree competitors charge $20–$40 a month.")]);
    const dataDir = tmpDir();
    const first = saas(provider, dataDir, { startWorker: true });
    const browser = client(first.app);
    await browser.json("/api/auth/signup", { body: { email: "founder@example.com", password: "a strong password" } });

    const project = (await browser.json<Project>("/api/projects", { body: { title: "Pricing study", goal: "Pick a launch price" } })).body;
    const created = await browser.json<Task>("/api/tasks", {
      body: { agentId: "researcher", title: "Competitor pricing", instructions: "Summarise competitor pricing.", projectId: project.id },
    });
    expect(created.status).toBe(201);
    expect(created.body.projectId).toBe(project.id);

    // Nobody calls drain(): the background worker pool picks the task up.
    const done = await until(async () => {
      const t = (await browser.json<{ task: Task }>(`/api/tasks/${created.body.id}`)).body.task;
      return t.status === "completed" ? t : null;
    });
    expect(done.output).toContain("Three competitors");
    expect(done.execution.mode).toBe("live");
    expect(String((provider.calls[0].messages[0] as { content: unknown }).content)).toContain("Pricing study");
    expect(String((provider.calls[0].messages[0] as { content: unknown }).content)).toContain("Pick a launch price");

    // "Refresh": restart the whole server on the same data directory.
    await first.stop();
    const second = saas(new ScriptedProvider([]), dataDir);
    const again = client(second.app);
    expect((await again.json("/api/auth/login", { body: { email: "founder@example.com", password: "a strong password" } })).status).toBe(200);
    const snap = (await again.json<TownSnapshot>("/api/snapshot")).body;
    expect(snap.projects.map((p) => p.title)).toEqual(["Pricing study"]);
    const persisted = snap.tasks.find((t) => t.id === created.body.id)!;
    expect(persisted.status).toBe("completed");
    expect(persisted.output).toContain("Three competitors");
    expect(persisted.projectId).toBe(project.id);
    expect((await again.json<Task[]>(`/api/tasks?projectId=${project.id}`)).body).toHaveLength(1);
  });

  it("closes idle towns and reopens them when retried work comes due", async () => {
    const provider = new ScriptedProvider([() => new Error("overloaded"), say("Second time lucky.")]);
    const s = saas(provider, tmpDir(), { startWorker: true, idleMs: 0, timings: { retryBaseMs: 400, statusDecayMs: 5 } });
    const browser = client(s.app);
    await browser.json("/api/auth/signup", { body: { email: "f@example.com", password: "correct horse battery" } });
    const townId = s.accounts.townOf(s.accounts.findByEmail("f@example.com")!.account.id)!;
    const task = (await browser.json<Task>("/api/tasks", { body: { agentId: "researcher", title: "Flaky", instructions: "Try" } })).body;

    // First attempt fails → retry_wait. The town then sits idle and is closed with a wake time.
    await until(async () => {
      s.towns.loop();
      return !s.towns.isOpen(townId);
    });
    const wakeAt = (s.accounts.db.prepare("SELECT wake_at FROM towns WHERE id = ?").get(townId) as { wake_at: string }).wake_at;
    expect(wakeAt).toBeTruthy();
    expect(provider.calls).toHaveLength(1);

    // The pool reopens it when the retry is due and finishes the task — no browser involved.
    await until(async () => {
      s.towns.loop();
      return provider.calls.length === 2;
    });
    const done = await until(async () => {
      const t = (await browser.json<{ task: Task }>(`/api/tasks/${task.id}`)).body.task;
      return t.status === "completed" ? t : null;
    });
    expect(done.output).toBe("Second time lucky.");
  });

  it("holds work when the trial has ended and resumes when the plan allows it", async () => {
    const provider = new ScriptedProvider([say("Done.")]);
    const s = saas(provider);
    const browser = client(s.app);
    await browser.json("/api/auth/signup", { body: { email: "g@example.com", password: "correct horse battery" } });
    const userId = s.accounts.findByEmail("g@example.com")!.account.id;
    s.accounts.setTrialEnd(userId, new Date(Date.now() - 1000).toISOString());
    s.towns.refreshEntitlements(userId);
    const me = (await browser.json("/api/auth/me")).body;
    expect(me.plan.canRun).toBe(false);

    const task = (await browser.json<Task>("/api/tasks", { body: { agentId: "researcher", title: "Held", instructions: "Wait" } })).body;
    const town = s.towns.get(s.accounts.townOf(userId)!);
    await town.app.runner.tick();
    expect(provider.calls).toHaveLength(0);

    s.accounts.applySubscription(userId, { subscriptionId: "sub_1", plan: "starter", status: "active", currentPeriodEnd: null, cancelAtPeriodEnd: false, eventCreated: 1 });
    s.towns.refreshEntitlements(userId);
    expect(town.config.workerConcurrency).toBe(2);
    await town.app.runner.drain();
    expect((await browser.json<{ task: Task }>(`/api/tasks/${task.id}`)).body.task.status).toBe("completed");
  });
});
