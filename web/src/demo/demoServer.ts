/**
 * Static demo backend (only in `npm run build:demo`).
 *
 * The real app needs its Node server (Claude, SQLite, the worker). For a link
 * that works on any static host (Netlify, a claude.ai page, GitHub Pages) this
 * replays a session RECORDED from the real server in simulation mode — no AI was
 * called, and nothing here calls one. The UI talks to it through the same `api`
 * client, so what you see is the real interface reacting to real event shapes.
 *
 * Cosmetic edits (wardrobe, names, timezone) work locally in the browser; anything
 * that would do work (tasks, hiring, schedules) explains that it needs the full app.
 */
import type { Agent, TownEvent, TownSettings, TownSnapshot, TreasurySummary } from "../../../shared/types";

interface Frame {
  t: number;
  events: TownEvent[];
  agents: TownSnapshot["agents"];
  stats: TownSnapshot["stats"];
  tasks: TownSnapshot["tasks"];
  approvals: TownSnapshot["approvals"];
  workflows: TownSnapshot["workflows"];
}
interface Fixture {
  recordedAt: string;
  initial: TownSnapshot;
  frames: Frame[];
  treasury: TreasurySummary;
}

export const DEMO_NOTICE = "This is a static demo replaying a recorded simulation, so it can't run new work. Run Agentopia yourself (npm run dev) with your own API key to assign real tasks.";
const LEAD_IN_MS = 6000;
const HOLD_MS = 30000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export class DemoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let fixture: Fixture | null = null;
let loading: Promise<Fixture> | null = null;
function load(): Promise<Fixture> {
  loading ??= import("./fixture.json").then((m) => (fixture = m.default as unknown as Fixture));
  return loading;
}

// ── replay state ──
let loopStart = 0;
let frameIdx = 0;
let current: Omit<Frame, "t" | "events"> | null = null;
let events: TownEvent[] = [];
let nextId = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(e: TownEvent) => void>();
const agentOverlay = new Map<string, Partial<Agent>>();
let settingsOverlay: Partial<TownSettings> = {};

/** Shift every ISO timestamp so the recording looks like it happened just now. */
function restamp<T>(value: T, shiftMs: number): T {
  if (typeof value === "string") return (ISO.test(value) ? new Date(Date.parse(value) + shiftMs).toISOString() : value) as T;
  if (Array.isArray(value)) return value.map((v) => restamp(v, shiftMs)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = restamp(v, shiftMs);
    return out as T;
  }
  return value;
}

function shift(f: Fixture) {
  return loopStart + LEAD_IN_MS - Date.parse(f.recordedAt);
}

function emit(e: Omit<TownEvent, "id">) {
  const ev = { ...e, id: ++nextId } as TownEvent;
  events = [...events, ev].slice(-500);
  for (const l of listeners) l(ev);
}

function startLoop(f: Fixture) {
  loopStart = Date.now();
  frameIdx = 0;
  current = { agents: f.initial.agents, stats: f.initial.stats, tasks: f.initial.tasks, approvals: f.initial.approvals, workflows: f.initial.workflows };
}

function tick() {
  const f = fixture;
  if (!f) return;
  const elapsed = Date.now() - loopStart - LEAD_IN_MS;
  while (frameIdx < f.frames.length && f.frames[frameIdx].t <= elapsed) {
    const fr = f.frames[frameIdx++];
    current = restamp({ agents: fr.agents, stats: fr.stats, tasks: fr.tasks, approvals: fr.approvals, workflows: fr.workflows }, shift(f));
    for (const e of fr.events) {
      const { id: _id, ...rest } = restamp(e, shift(f));
      void _id;
      emit(rest);
    }
  }
  const last = f.frames[f.frames.length - 1]?.t ?? 0;
  if (frameIdx >= f.frames.length && elapsed > last + HOLD_MS) {
    startLoop(f);
    emit({ ts: new Date().toISOString(), type: "agent.updated" as TownEvent["type"], agentId: null, taskId: null, message: "Demo replay restarted", data: { demo: true }, simulated: true });
  }
}

async function ensureStarted(): Promise<Fixture> {
  const f = await load();
  if (!timer) {
    startLoop(f);
    events = restamp(f.initial.events, shift(f)).map((e) => ({ ...e, id: ++nextId }));
    timer = setInterval(tick, 250);
  }
  return f;
}

function snapshot(f: Fixture): TownSnapshot {
  const base = restamp(f.initial, shift(f));
  const cur = current ?? base;
  return {
    ...base,
    agents: cur.agents.map((a) => ({ ...a, ...(agentOverlay.get(a.id) ?? {}) })),
    stats: cur.stats,
    tasks: cur.tasks,
    approvals: cur.approvals,
    workflows: cur.workflows,
    events,
    settings: { ...base.settings, ...settingsOverlay },
  };
}

const AGENT_FIELDS = ["appearance", "voice", "name", "personality"] as const;
const SETTINGS_FIELDS = ["timezone", "timezoneMode", "themeId"] as const;

/** Handles one API call the way the server would, from the replay. */
export async function demoCall(path: string, method: string, body: unknown): Promise<unknown> {
  const f = await ensureStarted();
  const url = new URL(path, "http://demo");
  const p = url.pathname;
  if (method === "GET" && p === "/api/snapshot") return snapshot(f);
  if (method === "GET" && p === "/api/treasury") return f.treasury;
  const agentMatch = p.match(/^\/api\/agents\/([^/]+)$/);
  if (agentMatch && method === "GET") {
    const snap = snapshot(f);
    const agent = snap.agents.find((a) => a.id === agentMatch[1]);
    if (!agent) throw new DemoError(404, "Agent not found");
    return { agent, tasks: snap.tasks.filter((t) => t.agentId === agent.id), events: snap.events.filter((e) => e.agentId === agent.id) };
  }
  if (agentMatch && method === "PATCH") {
    const id = agentMatch[1];
    const patch: Partial<Agent> = {};
    for (const k of AGENT_FIELDS) if (body && typeof body === "object" && k in body) (patch as Record<string, unknown>)[k] = (body as Record<string, unknown>)[k];
    if (!Object.keys(patch).length) throw new DemoError(403, DEMO_NOTICE);
    agentOverlay.set(id, { ...(agentOverlay.get(id) ?? {}), ...patch });
    const agent = snapshot(f).agents.find((a) => a.id === id);
    emit({ ts: new Date().toISOString(), type: "agent.updated" as TownEvent["type"], agentId: id, taskId: null, message: `${agent?.name ?? "A villager"} got a new look`, data: { cosmetic: true }, simulated: true });
    return agent;
  }
  const taskMatch = p.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && method === "GET") {
    const snap = snapshot(f);
    const task = snap.tasks.find((t) => t.id === taskMatch[1]);
    if (!task) throw new DemoError(404, "Task not found");
    return { task, events: snap.events.filter((e) => e.taskId === task.id) };
  }
  if (p === "/api/settings" && method === "PATCH") {
    for (const k of SETTINGS_FIELDS) if (body && typeof body === "object" && k in body) (settingsOverlay as Record<string, unknown>)[k] = (body as Record<string, unknown>)[k];
    return snapshot(f).settings;
  }
  throw new DemoError(403, DEMO_NOTICE);
}

export function demoSubscribe(onEvent: (e: TownEvent) => void, onStatus: (s: "connecting" | "live" | "offline") => void): () => void {
  listeners.add(onEvent);
  void ensureStarted().then(() => onStatus("live"));
  return () => void listeners.delete(onEvent);
}
