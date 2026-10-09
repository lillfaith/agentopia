import { create } from "zustand";
import type { Agent, AgentStats, TownEvent, TownSnapshot } from "../../../shared/types";
import { DEMO, api, subscribe, type AccountInfo } from "../api/client";

export type PanelId = "town" | "schedules" | "tasks" | "projects" | "log" | "approvals" | "rewards" | "treasury" | "settings" | "new-project";

/** A real hand-off between agents (from a task.handoff event) that the world animates. */
export interface Errand {
  id: number;
  fromAgentId: string;
  toAgentId: string;
  label: string;
  ts: number;
}

export interface Toast {
  id: number;
  tone: "info" | "good" | "warn" | "bad";
  text: string;
  agentId?: string | null;
}

interface UIState {
  snapshot: TownSnapshot | null;
  loadError: string | null;
  /** Signed-in account in SaaS mode; null for a self-hosted single town (or the demo). */
  account: AccountInfo | null;
  connection: "connecting" | "live" | "offline";
  errands: Errand[];
  toasts: Toast[];
  /** Latest real activity line per agent (task.step / tool_call), for speech bubbles. */
  activity: Record<string, { text: string; ts: number; taskId: string | null }>;

  selectedAgentId: string | null;
  selectedBuildingId: string | null;
  panel: PanelId | null;
  /** Villager whose wardrobe (customization) is open. */
  wardrobeAgentId: string | null;
  showNames: boolean;
  showBubbles: boolean;
  follow: boolean;
  /** Manual lighting hour (screenshots/testing); null = follow real local time. Never affects schedules. */
  lightingOverride: number | null;
  sound: boolean;
  /** Incremented to ask the camera to fly back to the overview. */
  overviewRequest: number;

  load: () => Promise<void>;
  signOut: () => Promise<void>;
  connect: () => () => void;
  selectAgent: (id: string | null) => void;
  selectBuilding: (id: string | null) => void;
  openPanel: (p: PanelId | null) => void;
  openWardrobe: (agentId: string | null) => void;
  toggle: (key: "showNames" | "showBubbles" | "follow" | "sound") => void;
  setLightingOverride: (hour: number | null) => void;
  requestOverview: () => void;
  dismissToast: (id: number) => void;
  pushToast: (t: Omit<Toast, "id">) => void;
}

let toastSeq = 0;
let accountChecked = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
/** Event listeners outside React (sound effects). */
export const eventListeners = new Set<(e: TownEvent) => void>();

function pref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`agentopia.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`agentopia.${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export const useTown = create<UIState>((set, get) => ({
  snapshot: null,
  loadError: null,
  account: null,
  connection: "connecting",
  errands: [],
  toasts: [],
  activity: {},
  selectedAgentId: null,
  selectedBuildingId: null,
  panel: null,
  wardrobeAgentId: null,
  showNames: pref("showNames", true),
  showBubbles: pref("showBubbles", true),
  follow: false,
  lightingOverride: pref<number | null>("lightingOverride", null),
  sound: pref("sound", false),
  overviewRequest: 0,

  async load() {
    try {
      const snapshot = await api.snapshot();
      snapshot.projects ??= [];
      snapshot.rewards ??= { balance: 0, earnedToday: 0, dailyCap: 0, owned: [] };
      const activity = { ...get().activity };
      for (const e of snapshot.events) noteActivity(activity, e);
      // Only a multi-user server knows /api/auth/me; a self-hosted town answers 404. Asked once per sign-in.
      let account = get().account;
      if (!accountChecked && !DEMO) {
        account = await api.me().catch(() => null);
        accountChecked = true;
      }
      set({ snapshot, loadError: null, activity, account });
    } catch (err) {
      set({ loadError: err instanceof Error ? err.message : String(err) });
    }
  },

  async signOut() {
    await api.logout().catch(() => {});
    // A fresh page load tears the 3D world down cleanly and drops all town state from memory.
    window.location.reload();
  },

  connect() {
    return subscribe(
      (e) => handleEvent(e, set, get),
      (connection) => {
        set({ connection });
        if (connection === "live") void get().load();
      },
      () => {
        const events = get().snapshot?.events;
        return events?.length ? events[events.length - 1].id : 0;
      },
    );
  },

  selectAgent: (id) => set({ selectedAgentId: id, selectedBuildingId: null, follow: id ? get().follow : false }),
  selectBuilding: (id) => set({ selectedBuildingId: id, selectedAgentId: null, follow: false }),
  openPanel: (p) => set({ panel: get().panel === p ? null : p, wardrobeAgentId: null }),
  openWardrobe: (wardrobeAgentId) => set({ wardrobeAgentId, panel: wardrobeAgentId ? null : get().panel }),
  toggle: (key) => {
    const value = !get()[key];
    set({ [key]: value } as Partial<UIState>);
    if (key !== "follow") savePref(key, value);
  },
  setLightingOverride: (lightingOverride) => {
    set({ lightingOverride });
    savePref("lightingOverride", lightingOverride);
  },
  requestOverview: () => set({ overviewRequest: get().overviewRequest + 1, follow: false }),
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  pushToast: (t) => {
    const toast = { ...t, id: ++toastSeq };
    set({ toasts: [...get().toasts.slice(-4), toast] });
    setTimeout(() => get().dismissToast(toast.id), 7000);
  },
}));

function noteActivity(activity: UIState["activity"], e: TownEvent) {
  if (!e.agentId) return;
  if (e.type === "task.step" || e.type === "task.tool_call" || e.type === "task.started") {
    activity[e.agentId] = { text: e.message, ts: Date.parse(e.ts), taskId: e.taskId };
  }
}

type Set = (partial: Partial<UIState>) => void;
type Get = () => UIState;

function handleEvent(e: TownEvent, set: Set, get: Get) {
  const s = get();
  const snap = s.snapshot;
  if (!snap) return;
  if (snap.events.length && snap.events[snap.events.length - 1].id >= e.id) return; // duplicate on resume

  const events = [...snap.events, e].slice(-500);
  let agents = snap.agents;
  if (e.type === "agent.status" && e.agentId) {
    agents = agents.map((a): Agent =>
      a.id === e.agentId
        ? { ...a, status: (e.data.status as Agent["status"]) ?? a.status, statusDetail: e.message === e.data.status ? null : e.message, currentTaskId: e.taskId }
        : a,
    );
  }
  const activity = { ...s.activity };
  noteActivity(activity, e);
  set({ snapshot: { ...snap, events, agents }, activity });

  if (e.type === "task.handoff" && e.data.fromAgentId && e.data.toAgentId) {
    set({
      errands: [
        ...get().errands.slice(-10),
        { id: e.id, fromAgentId: String(e.data.fromAgentId), toAgentId: String(e.data.toAgentId), label: e.message, ts: Date.now() },
      ],
    });
  }

  const name = (id: string | null) => snap.agents.find((a) => a.id === id)?.name ?? "Someone";
  if (e.type === "task.approval_requested") s.pushToast({ tone: "warn", text: e.message, agentId: e.agentId });
  if (e.type === "task.failed") s.pushToast({ tone: "bad", text: e.message, agentId: e.agentId });
  if (e.type === "workflow.completed") s.pushToast({ tone: "good", text: `🎁 ${e.message}`, agentId: e.agentId });
  else if (e.type === "task.completed") s.pushToast({ tone: "good", text: `${name(e.agentId)}: ${e.message}`, agentId: e.agentId });

  for (const l of eventListeners) l(e);

  // Anything structural (tasks, approvals, stats) → refresh the authoritative snapshot, debounced.
  if (e.type !== "agent.status" && e.type !== "task.step") {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void get().load(), 250);
  }
}

// ───────────── derived helpers ─────────────

export function statsFor(snapshot: TownSnapshot | null, agentId: string): AgentStats {
  return (
    snapshot?.stats.find((s) => s.agentId === agentId) ?? { agentId, tasksCompleted: 0, tasksFailed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
  );
}

/** Cosmetic level, derived only from real completed tasks. */
export function levelFor(stats: AgentStats): { level: number; xp: number; next: number } {
  const xp = stats.tasksCompleted * 100;
  const level = 1 + Math.floor(Math.sqrt(stats.tasksCompleted));
  const next = level * level * 100;
  return { level, xp, next };
}

export const STATUS_LABEL: Record<Agent["status"], string> = {
  idle: "Idle",
  planning: "Planning",
  working: "Working",
  delivering: "Delivering",
  waiting_approval: "Needs approval",
  completed: "Completed",
  failed: "Failed",
};
