import { timingSafeEqual } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { SystemStatus, TownEvent, TownSnapshot } from "../../shared/types.js";
import type { Config } from "../config.js";
import { transaction } from "../db/database.js";
import type { Store } from "../db/store.js";
import { getTool, toolInfo } from "../agents/tools.js";
import { MODELS } from "../llm/models.js";
import type { TaskRunner } from "../engine/runner.js";
import { treasurySummary } from "../engine/treasury.js";
import { startCampaignWorkflow } from "../engine/workflows.js";

export const VERSION = "0.1.0";

export interface ApiDeps {
  config: Config;
  store: Store;
  runner: TaskRunner;
}

// ───────────────────────── validation schemas ─────────────────────────

const modelId = z.string().regex(/^claude-[a-z0-9.-]{2,60}$/, "Model ids look like claude-opus-5-5");
const toolId = z.string().refine((id) => !!getTool(id), "Unknown tool id");

const agentPatch = z
  .object({
    name: z.string().trim().min(1).max(40),
    role: z.string().trim().min(1).max(60),
    personality: z.string().max(1000),
    systemPrompt: z.string().trim().min(1).max(20000),
    responsibilities: z.array(z.string().trim().min(1).max(200)).max(20),
    model: modelId,
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
    tools: z.array(toolId).max(20).transform((ids) => [...new Set(ids)]),
    avatar: z.object({
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      accessory: z.string().regex(/^[a-z-]{1,30}$/),
    }),
    enabled: z.boolean(),
  })
  .partial()
  .strict();

const newTask = z
  .object({
    agentId: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    instructions: z.string().trim().min(1).max(20000),
    priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(1),
    dependsOn: z.array(z.string()).max(20).default([]),
  })
  .strict();

const settingsPatch = z
  .object({
    townName: z.string().trim().min(1).max(40),
    themeId: z.string().regex(/^[a-z0-9-]{1,40}$/),
    townTax: z
      .object({
        enabled: z.boolean(),
        mode: z.enum(["percent_of_cost", "per_million_tokens"]),
        rate: z.number().min(0).max(1000),
        weeklyCapUsd: z.number().min(0).max(100000),
        cause: z.string().max(200),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

const decision = z.object({ approve: z.boolean(), note: z.string().max(1000).nullable().optional() }).strict();

// ───────────────────────── security middleware ─────────────────────────

const LOOPBACK_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * - Bearer token when AGENTOPIA_ADMIN_TOKEN is set.
 * - Host header check on loopback deployments (DNS-rebinding protection).
 * - Mutations must be JSON with a same-origin (or absent) Origin (CSRF protection
 *   for the token-less local mode: browsers cannot send cross-site JSON without a
 *   CORS preflight, which this server never approves).
 */
function security(config: Config): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path === "/api/health") return next();
    const host = c.req.header("host") ?? "";
    if (!config.adminToken && !LOOPBACK_HOSTS.test(host)) return c.json({ error: "Forbidden host" }, 403);
    if (config.adminToken) {
      const header = c.req.header("authorization") ?? "";
      const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
      const expected = Buffer.from(config.adminToken);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return c.json({ error: "Unauthorized" }, 401);
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      if (!(c.req.header("content-type") ?? "").includes("application/json")) return c.json({ error: "Expected application/json" }, 415);
      const origin = c.req.header("origin");
      if (origin) {
        let originHost = "";
        try {
          originHost = new URL(origin).host;
        } catch {
          /* invalid origin */
        }
        if (originHost !== host) return c.json({ error: "Cross-origin request rejected" }, 403);
      }
    }
    return next();
  };
}

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, res: c.json({ error: "Invalid JSON body" }, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, res: c.json({ error: "Validation failed", issues: parsed.error.issues }, 400) };
  return { ok: true, data: parsed.data };
}

// ───────────────────────── routes ─────────────────────────

export function systemStatus({ config, runner }: ApiDeps): SystemStatus {
  const p = runner.provider;
  return {
    version: VERSION,
    provider: {
      id: p.id,
      mode: p.simulated ? "simulation" : config.anthropicApiKey ? "live" : "unconfigured",
      keyConfigured: !!config.anthropicApiKey,
      refusalFallback: config.refusalFallback,
    },
    worker: { running: runner.running, concurrency: config.workerConcurrency, activeTasks: runner.activeCount },
    limits: { dailyBudgetUsd: config.dailyBudgetUsd, maxTurnsPerTask: config.maxTurnsPerTask, maxDelegationDepth: config.maxDelegationDepth },
    authRequired: !!config.adminToken,
    models: MODELS.map(({ id, label, inputPerMTok, outputPerMTok }) => ({ id, label, inputPerMTok, outputPerMTok })),
    tools: toolInfo(),
  };
}

export function createApi(deps: ApiDeps): Hono {
  const { config, store, runner } = deps;
  const api = new Hono();
  api.use("/api/*", security(config));

  api.get("/api/health", (c) => c.json({ ok: true, version: VERSION }));

  api.get("/api/snapshot", (c) => {
    const snapshot: TownSnapshot = {
      settings: store.getSettings(),
      agents: store.listAgents(),
      stats: store.agentStats(),
      buildings: store.listBuildings(),
      tasks: store.listTasks({ limit: 300 }),
      approvals: store.listApprovals({ limit: 100 }),
      workflows: store.listWorkflows(50),
      events: store.listEvents({ limit: 300 }),
      status: systemStatus(deps),
    };
    return c.json(snapshot);
  });

  api.get("/api/status", (c) => c.json(systemStatus(deps)));

  // agents
  api.get("/api/agents", (c) => c.json(store.listAgents()));
  api.get("/api/agents/:id", (c) => {
    const agent = store.getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    return c.json({
      agent,
      tasks: store.listTasks({ agentId: agent.id, limit: 50 }),
      events: store.listEvents({ agentId: agent.id, limit: 100 }),
    });
  });
  api.patch("/api/agents/:id", async (c) => {
    const id = c.req.param("id");
    if (!store.getAgent(id)) return c.json({ error: "Agent not found" }, 404);
    const b = await body(c, agentPatch);
    if (!b.ok) return b.res;
    const agent = store.updateAgent(id, b.data)!;
    store.addEvent({ type: "agent.updated", agentId: id, message: `${agent.name}'s profile was updated`, data: { fields: Object.keys(b.data) } });
    return c.json(agent);
  });

  // tasks
  api.get("/api/tasks", (c) => c.json(store.listTasks({ agentId: c.req.query("agentId"), workflowId: c.req.query("workflowId"), limit: 300 })));
  api.get("/api/tasks/:id", (c) => {
    const task = store.getTask(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    return c.json({ task, events: store.listEvents({ taskId: task.id, limit: 500 }), approvals: store.listApprovals({ taskId: task.id }) });
  });
  api.post("/api/tasks", async (c) => {
    const b = await body(c, newTask);
    if (!b.ok) return b.res;
    const agent = store.getAgent(b.data.agentId);
    if (!agent) return c.json({ error: "Unknown agent" }, 400);
    for (const dep of b.data.dependsOn) if (!store.getTask(dep)) return c.json({ error: `Unknown dependency ${dep}` }, 400);
    const task = store.createTask({ ...b.data, createdBy: "user" });
    store.addEvent({
      type: "task.created",
      agentId: agent.id,
      taskId: task.id,
      message: `You assigned “${task.title}” to ${agent.name}`,
      data: { createdBy: "user" },
    });
    void runner.tick();
    return c.json(task, 201);
  });
  api.post("/api/tasks/:id/cancel", (c) => {
    const r = runner.cancelTask(c.req.param("id"));
    return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 409);
  });
  api.post("/api/tasks/:id/retry", (c) => {
    const r = runner.retryTask(c.req.param("id"));
    return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 409);
  });

  // workflows
  api.get("/api/workflows", (c) => c.json(store.listWorkflows(50)));
  api.post("/api/workflows/campaign", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    try {
      const wf = transaction(store.db, () => startCampaignWorkflow(store, raw));
      void runner.tick();
      return c.json(wf, 201);
    } catch (err) {
      if (err instanceof z.ZodError) return c.json({ error: "Validation failed", issues: err.issues }, 400);
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  // approvals
  api.get("/api/approvals", (c) => c.json(store.listApprovals({ limit: 100 })));
  api.post("/api/approvals/:id/decide", async (c) => {
    const b = await body(c, decision);
    if (!b.ok) return b.res;
    const r = runner.decideApproval(c.req.param("id"), b.data.approve, b.data.note ?? null);
    return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 409);
  });

  // events
  api.get("/api/events", (c) => {
    const since = c.req.query("since");
    return c.json(
      store.listEvents({
        sinceId: since ? Number(since) : undefined,
        agentId: c.req.query("agentId"),
        taskId: c.req.query("taskId"),
        limit: Math.min(Number(c.req.query("limit") ?? 200) || 200, 1000),
      }),
    );
  });

  /** Live event stream (Server-Sent Events). Resumes from Last-Event-ID / ?since. */
  api.get("/api/stream", (c) =>
    streamSSE(c, async (stream) => {
      const since = Number(c.req.header("last-event-id") ?? c.req.query("since") ?? NaN);
      const queue: TownEvent[] = [];
      let wake: (() => void) | null = null;
      const onEvent = (e: TownEvent) => {
        queue.push(e);
        wake?.();
      };
      store.bus.on("event", onEvent);
      stream.onAbort(() => {
        store.bus.off("event", onEvent);
        wake?.();
      });
      if (Number.isFinite(since)) queue.unshift(...store.listEvents({ sinceId: since, limit: 1000 }));
      await stream.writeSSE({ event: "hello", data: JSON.stringify({ version: VERSION }) });
      while (!stream.aborted) {
        while (queue.length) {
          const e = queue.shift()!;
          await stream.writeSSE({ id: String(e.id), event: "town", data: JSON.stringify(e) });
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 15_000);
        });
        wake = null;
        if (!queue.length && !stream.aborted) await stream.writeSSE({ event: "ping", data: "{}" });
      }
    }),
  );

  // treasury & settings
  api.get("/api/treasury", (c) => c.json(treasurySummary(store, config.dailyBudgetUsd)));
  api.get("/api/settings", (c) => c.json(store.getSettings()));
  api.patch("/api/settings", async (c) => {
    const b = await body(c, settingsPatch);
    if (!b.ok) return b.res;
    const settings = store.updateSettings(b.data as Parameters<Store["updateSettings"]>[0]);
    store.addEvent({ type: "system.notice", message: "Town settings updated", data: { fields: Object.keys(b.data) } });
    return c.json(settings);
  });

  api.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
  api.onError((err, c) => {
    console.error("[api]", err);
    return c.json({ error: "Internal server error" }, 500);
  });
  return api;
}
