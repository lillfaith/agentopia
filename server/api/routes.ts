import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Schedule, SystemStatus, TownEvent, TownSnapshot } from "../../shared/types.js";
import type { Config } from "../config.js";
import { transaction } from "../db/database.js";
import type { Store } from "../db/store.js";
import { AGENT_TEMPLATES } from "../agents/templates.js";
import { MODELS } from "../llm/models.js";
import { getSkill, skillInfo } from "../skills/index.js";
import { budgetStatus } from "../engine/budget.js";
import type { TaskRunner } from "../engine/runner.js";
import { computeNextRun, isValidTimezone, validateCadence } from "../engine/scheduler.js";
import { treasurySummary } from "../engine/treasury.js";
import { achievements, buyItem, ledger, rewardsSummary, unownedWearables } from "../engine/rewards.js";
import { runVerification } from "../engine/verify.js";
import { startCampaignWorkflow } from "../engine/workflows.js";
import { body, security } from "./security.js";
import { EAR_STYLES, EXPRESSIONS, EYE_STYLES, TAIL_STYLES, VOICE_PRESET_IDS, WEARABLE_SLOTS, defaultAppearance, defaultVoice, wearable } from "../../shared/cosmetics.js";

export const VERSION = "0.2.0";

export interface ApiDeps {
  config: Config;
  store: Store;
  runner: TaskRunner;
  /** True when mounted behind the SaaS account layer (which authenticates and checks CSRF). */
  embedded?: boolean;
}

// ───────────────────────── validation schemas ─────────────────────────

const modelId = z.string().regex(/^claude-[a-z0-9.-]{2,60}$/, "Model ids look like claude-opus-5-5");
const skillIds = z
  .array(z.string().refine((id) => !!getSkill(id), "Unknown skill id"))
  .max(20)
  .transform((ids) => [...new Set(ids)]);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb colour");
const slugish = z.string().regex(/^[a-z0-9-]{1,30}$/, "Use lowercase letters, numbers and dashes");
const priority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const money = z.number().min(0).max(100000);

const agentFields = {
  name: z.string().trim().min(1).max(40),
  role: z.string().trim().min(1).max(60),
  personality: z.string().max(1000),
  systemPrompt: z.string().trim().min(1).max(20000),
  responsibilities: z.array(z.string().trim().min(1).max(200)).max(20),
  model: modelId,
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
  skills: skillIds,
  /** Legacy look (colour + one accessory); prefer `appearance`. */
  avatar: z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/), accessory: z.string().regex(/^[a-z-]{1,30}$/) }),
  appearance: z
    .object({
      bodyColor: hex,
      accentColor: hex,
      cheekColor: hex,
      eyes: z.enum(EYE_STYLES),
      expression: z.enum(EXPRESSIONS),
      ears: z.enum(EAR_STYLES),
      tail: z.enum(TAIL_STYLES),
      size: z.number().min(0.85).max(1.2),
      wearables: z
        .object(Object.fromEntries(WEARABLE_SLOTS.map((slot) => [slot, z.string().refine((id) => wearable(id)?.slot === slot, `Not a ${slot} item`).optional()])))
        .strict(),
    })
    .strict(),
  voice: z
    .object({
      preset: z.enum(VOICE_PRESET_IDS),
      pitch: z.number().min(-12).max(12),
      speed: z.number().min(0.5).max(2),
      tone: z.number().min(0).max(1),
      texture: z.number().min(0).max(1),
    })
    .strict(),
  buildingId: z.string().min(1),
  dailyBudgetUsd: money.nullable(),
};

const agentPatch = z.object({ ...agentFields, enabled: z.boolean() }).partial().strict();
const agentCreate = z
  .object({ ...agentFields, personality: agentFields.personality.default(""), responsibilities: agentFields.responsibilities.default([]), dailyBudgetUsd: money.nullable().default(null) })
  .partial({ model: true, effort: true, avatar: true, appearance: true, voice: true })
  .strict();

const LEGACY_ACCESSORY: Record<string, string> = { crown: "crown", beret: "beret", goggles: "goggles", sprout: "sprout" };

const buildingCreate = z
  .object({
    name: z.string().trim().min(1).max(40),
    department: z.string().trim().min(1).max(60),
    kind: slugish,
    slot: slugish,
    description: z.string().max(500).default(""),
  })
  .strict();
const buildingPatch = buildingCreate.partial().strict();

const newTask = z
  .object({
    agentId: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    instructions: z.string().trim().min(1).max(20000),
    priority: priority.default(1),
    dependsOn: z.array(z.string()).max(20).default([]),
    projectId: z.string().min(1).nullable().optional(),
  })
  .strict();

const projectCreate = z.object({ title: z.string().trim().min(1).max(80), goal: z.string().trim().max(2000).default("") }).strict();
const projectPatch = z.object({ title: z.string().trim().min(1).max(80), goal: z.string().trim().max(2000), status: z.enum(["active", "archived"]) }).partial().strict();

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM");
const cadence = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("interval"), everyMinutes: z.number().int().positive().max(60 * 24 * 31) }).strict(),
  z.object({ kind: z.literal("daily"), time: hhmm }).strict(),
  z
    .object({ kind: z.literal("weekly"), days: z.array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)])).min(1).max(7), time: hhmm })
    .strict(),
]);
const target = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task"), agentId: z.string().min(1), title: z.string().trim().min(1).max(200), instructions: z.string().trim().min(1).max(20000), priority: priority.default(1) }).strict(),
  z.object({ type: z.literal("campaign"), topic: z.string().trim().min(3).max(500), audience: z.string().trim().max(500).default(""), goal: z.string().trim().max(1000).default("") }).strict(),
]);
const scheduleFields = {
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  cadence,
  timezone: z.string().refine(isValidTimezone, "Unknown IANA timezone (e.g. Europe/London)"),
  target,
  overlap: z.enum(["skip", "queue"]),
};
const scheduleCreate = z.object({ ...scheduleFields, enabled: scheduleFields.enabled.default(true), overlap: scheduleFields.overlap.default("skip") }).strict();
const schedulePatch = z.object(scheduleFields).partial().strict();

const settingsPatch = z
  .object({
    townName: z.string().trim().min(1).max(40),
    themeId: z.string().regex(/^[a-z0-9-]{1,40}$/),
    timezone: z.string().refine(isValidTimezone, "Unknown IANA timezone"),
    timezoneMode: z.enum(["auto", "manual"]),
    townTax: z
      .object({
        enabled: z.boolean(),
        mode: z.enum(["percent_of_cost", "per_million_tokens"]),
        rate: z.number().min(0).max(1000),
        weeklyCapUsd: money,
        cause: z.string().max(200),
      })
      .partial()
      .strict(),
    budget: z.object({ dailyUsd: money.nullable(), monthlyUsd: money.nullable(), perTaskUsd: money.nullable() }).partial().strict(),
  })
  .partial()
  .strict();

const decision = z.object({ approve: z.boolean(), note: z.string().max(1000).nullable().optional() }).strict();

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "item";

// ───────────────────────── status ─────────────────────────

export function systemStatus({ config, store, runner, embedded }: ApiDeps): SystemStatus {
  const p = runner.provider;
  const base = process.env.ANTHROPIC_BASE_URL?.trim();
  let baseUrlHost: string | null = null;
  if (base) {
    try {
      const host = new URL(base).host;
      baseUrlHost = host === "api.anthropic.com" ? null : host;
    } catch {
      baseUrlHost = "invalid ANTHROPIC_BASE_URL";
    }
  }
  return {
    version: VERSION,
    role: config.role === "api" ? "api" : "all",
    provider: {
      id: p.id,
      mode: p.simulated ? "simulation" : config.anthropicApiKey ? "live" : "unconfigured",
      keyConfigured: !!config.anthropicApiKey,
      refusalFallback: config.refusalFallback,
      baseUrlHost: embedded ? null : baseUrlHost,
    },
    worker: { running: runner.running, concurrency: config.workerConcurrency, activeTasks: runner.activeCount },
    // Worker hostnames and pids are operator details, not shown to SaaS users.
    workers: embedded ? [] : store.listWorkers(),
    limits: {
      dailyBudgetUsd: config.dailyBudgetUsd,
      maxTurnsPerTask: config.maxTurnsPerTask,
      maxDelegationDepth: config.maxDelegationDepth,
      minScheduleIntervalMinutes: config.minScheduleIntervalMinutes,
    },
    budget: budgetStatus(store, config, p.simulated),
    authRequired: !!config.adminToken,
    models: MODELS.map(({ id, label, inputPerMTok, outputPerMTok }) => ({ id, label, inputPerMTok, outputPerMTok })),
    skills: skillInfo(),
    verifications: store.latestVerifications(),
  };
}

// ───────────────────────── routes ─────────────────────────

export function createApi(deps: ApiDeps): Hono {
  const { config, store, runner } = deps;
  const api = new Hono();
  if (!deps.embedded) api.use("/api/*", security(config));
  const err = (message: string) => ({ error: message });

  api.get("/api/health", (c) => c.json({ ok: true, version: VERSION }));

  /** Readiness for orchestrators: database reachable and (unless API-only) a live worker. */
  api.get("/api/ready", (c) => {
    try {
      store.maxEventId();
    } catch {
      return c.json({ ready: false, reason: "database unavailable" }, 503);
    }
    const workers = store.listWorkers().filter((w) => w.alive);
    if (config.role !== "api" && !workers.length) return c.json({ ready: false, reason: "no live worker" }, 503);
    return c.json({ ready: true, workers: workers.length });
  });

  api.get("/api/snapshot", (c) => {
    const snapshot: TownSnapshot = {
      settings: store.getSettings(),
      projects: store.listProjects(),
      rewards: rewardsSummary(store),
      agents: store.listAgents(),
      stats: store.agentStats(),
      buildings: store.listBuildings(),
      tasks: store.listTasks({ limit: 300 }),
      approvals: store.listApprovals({ limit: 100 }),
      workflows: store.listWorkflows(50),
      schedules: store.listSchedules(),
      events: store.listEvents({ limit: 300 }),
      status: systemStatus(deps),
      templates: AGENT_TEMPLATES,
    };
    return c.json(snapshot);
  });

  api.get("/api/status", (c) => c.json(systemStatus(deps)));
  api.get("/api/templates", (c) => c.json(AGENT_TEMPLATES));

  // ── agents ──
  api.get("/api/agents", (c) => c.json(store.listAgents()));
  api.get("/api/agents/:id", (c) => {
    const agent = store.getAgent(c.req.param("id"));
    if (!agent) return c.json(err("Agent not found"), 404);
    return c.json({ agent, tasks: store.listTasks({ agentId: agent.id, limit: 50 }), events: store.listEvents({ agentId: agent.id, limit: 100 }) });
  });

  const modelNotAllowed = (model: string | undefined) =>
    model && config.allowedModels && !config.allowedModels.includes(model) ? `Your plan includes ${config.allowedModels.join(", ")}; ${model} needs an upgrade.` : null;

  api.post("/api/agents", async (c) => {
    const b = await body(c, agentCreate);
    if (!b.ok) return b.res;
    const blocked = modelNotAllowed(b.data.model);
    if (blocked) return c.json(err(blocked), 403);
    const locked = b.data.appearance ? unownedWearables(store, {}, b.data.appearance.wearables as Record<string, string | undefined>) : [];
    if (locked.length) return c.json(err(`Buy ${locked.join(", ")} in the shop first`), 403);
    if (!store.getBuilding(b.data.buildingId)) return c.json(err("Unknown building"), 400);
    let id = slugify(b.data.name);
    if (store.getAgent(id)) id = `${id}-${randomUUID().slice(0, 4)}`;
    const agent = store.insertAgent({
      id,
      name: b.data.name,
      role: b.data.role,
      personality: b.data.personality,
      systemPrompt: b.data.systemPrompt,
      responsibilities: b.data.responsibilities,
      model: b.data.model ?? config.defaultModel,
      effort: b.data.effort ?? "medium",
      skills: b.data.skills,
      appearance: (b.data.appearance as never) ?? defaultAppearance(b.data.avatar?.color, LEGACY_ACCESSORY[b.data.avatar?.accessory ?? ""]),
      voice: b.data.voice ?? defaultVoice(),
      buildingId: b.data.buildingId,
      enabled: true,
      dailyBudgetUsd: b.data.dailyBudgetUsd,
    });
    store.addEvent({ type: "agent.created", agentId: agent.id, message: `${agent.name} the ${agent.role} moved into town`, data: { buildingId: agent.buildingId } });
    return c.json(agent, 201);
  });

  api.patch("/api/agents/:id", async (c) => {
    const id = c.req.param("id");
    const current = store.getAgent(id);
    if (!current) return c.json(err("Agent not found"), 404);
    if (current.archived) return c.json(err("Restore this villager before editing"), 409);
    const b = await body(c, agentPatch);
    if (!b.ok) return b.res;
    const blocked = modelNotAllowed(b.data.model);
    if (blocked) return c.json(err(blocked), 403);
    if (b.data.appearance) {
      const locked = unownedWearables(store, current.appearance.wearables, b.data.appearance.wearables as Record<string, string | undefined>);
      if (locked.length) return c.json(err(`Buy ${locked.join(", ")} in the shop first`), 403);
    }
    if (b.data.buildingId && !store.getBuilding(b.data.buildingId)) return c.json(err("Unknown building"), 400);
    const { avatar, ...rest } = b.data;
    const patch = { ...rest } as Parameters<Store["updateAgent"]>[1];
    if (avatar && !rest.appearance) patch.appearance = { ...current.appearance, bodyColor: avatar.color };
    // Cosmetic-only edits (look, voice) never touch status or the current task.
    const agent = store.updateAgent(id, patch)!;
    const cosmetic = Object.keys(b.data).every((k) => ["appearance", "voice", "avatar"].includes(k));
    store.addEvent({
      type: "agent.updated",
      agentId: id,
      message: cosmetic ? `${agent.name} got a new look` : `${agent.name}'s profile was updated`,
      data: { fields: Object.keys(b.data), cosmetic },
    });
    return c.json(agent);
  });

  /** Archive (soft delete): history is kept; queued work is cancelled; schedules targeting the agent are paused. */
  api.delete("/api/agents/:id", (c) => {
    const id = c.req.param("id");
    const agent = store.getAgent(id);
    if (!agent) return c.json(err("Agent not found"), 404);
    if (agent.archived) return c.json({ ok: true });
    const tasks = store.listTasks({ agentId: id, limit: 500 });
    if (tasks.some((t) => t.status === "running")) return c.json(err(`${agent.name} is working right now — stop the task first`), 409);
    for (const t of tasks) if (["queued", "blocked", "retry_wait", "waiting_approval"].includes(t.status)) runner.cancelTask(t.id);
    for (const s of store.listSchedules()) {
      if (s.target.type === "task" && s.target.agentId === id && s.enabled) {
        store.updateSchedule(s.id, { enabled: false });
        store.addEvent({ type: "schedule.skipped", message: `Paused schedule “${s.name}” because ${agent.name} left town`, data: { scheduleId: s.id } });
      }
    }
    store.updateAgent(id, { archived: true, enabled: false });
    store.setAgentStatus(id, "idle", null, null);
    store.addEvent({ type: "agent.archived", agentId: id, message: `${agent.name} the ${agent.role} left town (archived — history kept)` });
    return c.json({ ok: true });
  });

  api.post("/api/agents/:id/restore", (c) => {
    const id = c.req.param("id");
    const agent = store.getAgent(id);
    if (!agent) return c.json(err("Agent not found"), 404);
    const buildingId = store.getBuilding(agent.buildingId) ? agent.buildingId : store.listBuildings()[0]?.id;
    if (!buildingId) return c.json(err("Create a building first"), 409);
    const restored = store.updateAgent(id, { archived: false, enabled: true, buildingId })!;
    store.addEvent({ type: "agent.created", agentId: id, message: `${restored.name} moved back into town` });
    return c.json(restored);
  });

  // ── buildings ──
  api.get("/api/buildings", (c) => c.json(store.listBuildings()));
  api.post("/api/buildings", async (c) => {
    const b = await body(c, buildingCreate);
    if (!b.ok) return b.res;
    if (store.isSlotTaken(b.data.slot)) return c.json(err("That plot is already occupied"), 409);
    let id = slugify(b.data.name);
    if (store.getBuilding(id)) id = `${id}-${randomUUID().slice(0, 4)}`;
    store.upsertBuilding({ id, ...b.data });
    const building = store.getBuilding(id)!;
    store.addEvent({ type: "building.created", message: `${building.name} (${building.department}) was built`, data: { buildingId: id } });
    return c.json(building, 201);
  });
  api.patch("/api/buildings/:id", async (c) => {
    const id = c.req.param("id");
    if (!store.getBuilding(id)) return c.json(err("Building not found"), 404);
    const b = await body(c, buildingPatch);
    if (!b.ok) return b.res;
    if (b.data.slot && store.isSlotTaken(b.data.slot, id)) return c.json(err("That plot is already occupied"), 409);
    const building = store.updateBuilding(id, b.data)!;
    store.addEvent({ type: "building.updated", message: `${building.name} was updated`, data: { buildingId: id, fields: Object.keys(b.data) } });
    return c.json(building);
  });
  api.delete("/api/buildings/:id", (c) => {
    const id = c.req.param("id");
    const building = store.getBuilding(id);
    if (!building) return c.json(err("Building not found"), 404);
    const residents = store.listAgents().filter((a) => a.buildingId === id && !a.archived);
    if (residents.length) return c.json(err(`Move ${residents.map((a) => a.name).join(", ")} to another building first`), 409);
    store.deleteBuilding(id);
    store.addEvent({ type: "building.deleted", message: `${building.name} was demolished`, data: { buildingId: id } });
    return c.json({ ok: true });
  });

  // ── projects ──
  api.get("/api/projects", (c) => c.json(store.listProjects()));
  api.get("/api/projects/:id", (c) => {
    const project = store.getProject(c.req.param("id"));
    if (!project) return c.json(err("Project not found"), 404);
    return c.json({ project, tasks: store.listTasks({ projectId: project.id, limit: 300 }) });
  });
  api.post("/api/projects", async (c) => {
    const b = await body(c, projectCreate);
    if (!b.ok) return b.res;
    const project = store.createProject(b.data);
    store.addEvent({ type: "system.notice", message: `New project: ${project.title}`, data: { projectId: project.id } });
    return c.json(project, 201);
  });
  api.patch("/api/projects/:id", async (c) => {
    const id = c.req.param("id");
    if (!store.getProject(id)) return c.json(err("Project not found"), 404);
    const b = await body(c, projectPatch);
    if (!b.ok) return b.res;
    return c.json(store.updateProject(id, b.data));
  });

  // ── tasks ──
  api.get("/api/tasks", (c) =>
    c.json(store.listTasks({ agentId: c.req.query("agentId"), workflowId: c.req.query("workflowId"), projectId: c.req.query("projectId"), limit: 300 })),
  );
  api.get("/api/tasks/:id", (c) => {
    const task = store.getTask(c.req.param("id"));
    if (!task) return c.json(err("Task not found"), 404);
    return c.json({ task, events: store.listEvents({ taskId: task.id, limit: 500 }), approvals: store.listApprovals({ taskId: task.id }) });
  });
  api.post("/api/tasks", async (c) => {
    const b = await body(c, newTask);
    if (!b.ok) return b.res;
    const agent = store.getAgent(b.data.agentId);
    if (!agent || agent.archived) return c.json(err("Unknown agent"), 400);
    for (const dep of b.data.dependsOn) if (!store.getTask(dep)) return c.json(err(`Unknown dependency ${dep}`), 400);
    if (b.data.projectId && store.getProject(b.data.projectId)?.status !== "active") return c.json(err("Unknown or archived project"), 400);
    const task = store.createTask({ ...b.data, createdBy: "user" });
    store.addEvent({ type: "task.created", agentId: agent.id, taskId: task.id, message: `You assigned “${task.title}” to ${agent.name}`, data: { createdBy: "user" } });
    runner.poke();
    return c.json(task, 201);
  });
  api.post("/api/tasks/:id/cancel", (c) => {
    const r = runner.cancelTask(c.req.param("id"));
    return r.ok ? c.json({ ok: true }) : c.json(err(r.error!), 409);
  });
  api.post("/api/tasks/:id/retry", (c) => {
    const r = runner.retryTask(c.req.param("id"));
    return r.ok ? c.json({ ok: true }) : c.json(err(r.error!), 409);
  });

  // ── workflows ──
  api.get("/api/workflows", (c) => c.json(store.listWorkflows(50)));
  api.post("/api/workflows/campaign", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(err("Invalid JSON body"), 400);
    }
    try {
      const wf = transaction(store.db, () => startCampaignWorkflow(store, raw));
      runner.poke();
      return c.json(wf, 201);
    } catch (e) {
      if (e instanceof z.ZodError) return c.json({ error: "Validation failed", issues: e.issues }, 400);
      return c.json(err(e instanceof Error ? e.message : String(e)), 400);
    }
  });

  // ── schedules ──
  const checkScheduleTarget = (t: Schedule["target"]): string | null => {
    if (t.type !== "task") return null;
    const a = store.getAgent(t.agentId);
    return !a || a.archived ? "Unknown or archived agent" : null;
  };
  api.get("/api/schedules", (c) => c.json(store.listSchedules()));
  api.post("/api/schedules", async (c) => {
    const b = await body(c, scheduleCreate);
    if (!b.ok) return b.res;
    try {
      validateCadence(b.data.cadence, config.minScheduleIntervalMinutes);
    } catch (e) {
      return c.json(err(String(e instanceof Error ? e.message : e)), 400);
    }
    const targetError = checkScheduleTarget(b.data.target as Schedule["target"]);
    if (targetError) return c.json(err(targetError), 400);
    const schedule = store.insertSchedule({
      id: randomUUID(),
      ...b.data,
      target: b.data.target as Schedule["target"],
      nextRunAt: b.data.enabled ? computeNextRun(b.data.cadence, b.data.timezone, new Date()).toISOString() : null,
    });
    store.addEvent({ type: "system.notice", message: `New schedule “${schedule.name}” — next run ${schedule.nextRunAt ?? "paused"}`, data: { scheduleId: schedule.id } });
    return c.json(schedule, 201);
  });
  api.patch("/api/schedules/:id", async (c) => {
    const id = c.req.param("id");
    const current = store.getSchedule(id);
    if (!current) return c.json(err("Schedule not found"), 404);
    const b = await body(c, schedulePatch);
    if (!b.ok) return b.res;
    const next = { ...current, ...b.data } as Schedule;
    try {
      validateCadence(next.cadence, config.minScheduleIntervalMinutes);
    } catch (e) {
      return c.json(err(String(e instanceof Error ? e.message : e)), 400);
    }
    const targetError = checkScheduleTarget(next.target);
    if (targetError) return c.json(err(targetError), 400);
    const timingChanged = b.data.cadence !== undefined || b.data.timezone !== undefined || b.data.enabled !== undefined;
    const nextRunAt = !next.enabled ? null : timingChanged || !current.nextRunAt ? computeNextRun(next.cadence, next.timezone, new Date()).toISOString() : current.nextRunAt;
    const schedule = store.updateSchedule(id, { ...b.data, target: next.target, nextRunAt })!;
    return c.json(schedule);
  });
  api.delete("/api/schedules/:id", (c) => {
    const id = c.req.param("id");
    const s = store.getSchedule(id);
    if (!s) return c.json(err("Schedule not found"), 404);
    store.deleteSchedule(id);
    store.addEvent({ type: "system.notice", message: `Deleted schedule “${s.name}”`, data: { scheduleId: id } });
    return c.json({ ok: true });
  });
  api.post("/api/schedules/:id/run", (c) => {
    const s = store.getSchedule(c.req.param("id"));
    if (!s) return c.json(err("Schedule not found"), 404);
    const r = runner.scheduler.fire(s, "manual");
    runner.poke();
    return r.fired ? c.json(r) : c.json(err(r.outcome), 409);
  });

  // ── approvals ──
  api.get("/api/approvals", (c) => c.json(store.listApprovals({ limit: 100 })));
  api.post("/api/approvals/:id/decide", async (c) => {
    const b = await body(c, decision);
    if (!b.ok) return b.res;
    const r = runner.decideApproval(c.req.param("id"), b.data.approve, b.data.note ?? null);
    return r.ok ? c.json({ ok: true }) : c.json(err(r.error!), 409);
  });

  // ── rewards & shop (coins are earned server-side only; there is no endpoint that grants them) ──
  api.get("/api/rewards", (c) => c.json({ ...rewardsSummary(store), ledger: ledger(store, 50), achievements: achievements(store) }));
  api.post("/api/shop/buy", async (c) => {
    const b = await body(c, z.object({ itemId: z.string().min(1).max(60) }).strict());
    if (!b.ok) return b.res;
    const r = buyItem(store, b.data.itemId);
    return r.ok ? c.json(r) : c.json(err(r.error), 409);
  });

  // ── system: emergency stop ──
  api.post("/api/system/stop", (c) => c.json({ ok: true, ...runner.emergencyStop() }));
  api.post("/api/system/resume", (c) => {
    runner.resume();
    return c.json({ ok: true });
  });

  // ── system: live connection test ──
  api.post("/api/system/test-connection", async (c) => {
    if (deps.embedded) return c.json(err("Not available"), 404);
    const provider = runner.provider;
    if (provider.simulated) return c.json(err("Simulation mode is on — there is no API to test. Add ANTHROPIC_API_KEY and restart."), 409);
    if (!config.anthropicApiKey) return c.json(err("No ANTHROPIC_API_KEY is configured on the server."), 409);
    if (budgetStatus(store, config).globalHold) return c.json(err("Budget limit reached — raise it before testing."), 409);
    const [r] = await runVerification(provider, { model: config.defaultModel, checks: ["messages"], maxTokens: 1024 });
    if (r.requestId) {
      store.recordUsage({
        agentId: "system", taskId: null, model: r.model ?? config.defaultModel, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0,
        webSearchRequests: 0, webFetchRequests: 0, codeExecutions: 0, costUsd: r.costUsd, simulated: false, requestId: r.requestId, requestedModel: config.defaultModel,
      });
    }
    const v = store.addVerification({ checkId: r.checkId, ok: r.ok, detail: r.detail, requestId: r.requestId, model: r.model, costUsd: r.costUsd, source: "connection-test" });
    store.addEvent({ type: "system.verification", message: `Connection test ${r.ok ? "passed" : "FAILED"}: ${r.detail}`, data: { checkId: r.checkId, ok: r.ok, requestId: r.requestId } });
    return c.json(v, r.ok ? 200 : 502);
  });

  // ── events ──
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

  /**
   * Live event stream (SSE). Tails the events TABLE, so events written by a
   * separate worker process reach the browser too. In-process events wake the
   * loop immediately; otherwise it polls every second. Resumes from Last-Event-ID / ?since.
   */
  api.get("/api/stream", (c) =>
    streamSSE(c, async (stream) => {
      const sinceRaw = Number(c.req.header("last-event-id") ?? c.req.query("since") ?? NaN);
      let lastId = Number.isFinite(sinceRaw) ? sinceRaw : store.maxEventId();
      let wake: (() => void) | null = null;
      const onEvent = () => wake?.();
      store.bus.on("event", onEvent);
      stream.onAbort(() => {
        store.bus.off("event", onEvent);
        wake?.();
      });
      await stream.writeSSE({ event: "hello", data: JSON.stringify({ version: VERSION }) });
      let idleMs = 0;
      while (!stream.aborted) {
        const batch: TownEvent[] = store.tailEvents(lastId, 500);
        for (const e of batch) {
          await stream.writeSSE({ id: String(e.id), event: "town", data: JSON.stringify(e) });
          lastId = e.id;
        }
        if (batch.length === 500) continue;
        if (batch.length) idleMs = 0;
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 1000);
        });
        wake = null;
        idleMs += 1000;
        if (idleMs >= 15_000 && !stream.aborted) {
          idleMs = 0;
          await stream.writeSSE({ event: "ping", data: "{}" });
        }
      }
    }),
  );

  // ── treasury & settings ──
  api.get("/api/treasury", (c) => c.json(treasurySummary(store, config, runner.provider.simulated)));
  api.get("/api/settings", (c) => c.json(store.getSettings()));
  api.patch("/api/settings", async (c) => {
    const b = await body(c, settingsPatch);
    if (!b.ok) return b.res;
    const settings = store.updateSettings(b.data as Parameters<Store["updateSettings"]>[0]);
    store.addEvent({ type: "system.notice", message: "Town settings updated", data: { fields: Object.keys(b.data) } });
    return c.json(settings);
  });

  api.all("/api/*", (c) => c.json(err("Not found"), 404));
  api.onError((e, c) => {
    console.error("[api]", e);
    return c.json(err("Internal server error"), 500);
  });
  return api;
}
