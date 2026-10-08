import type { Agent, Building, Schedule, Task, TownEvent, TownSettings, TownSnapshot, TreasurySummary, Verification, Workflow } from "../../../shared/types";

import { DemoError, demoCall, demoSubscribe } from "../demo/demoServer";

/** True in the static demo build (`npm run build:demo`), which replays a recorded session in the browser. */
export const DEMO = import.meta.env.VITE_DEMO === "1";

const TOKEN_KEY = "agentopia.adminToken";

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (DEMO) {
    try {
      return (await demoCall(path, init.method ?? "GET", init.body ? JSON.parse(String(init.body)) : undefined)) as T;
    } catch (err) {
      if (err instanceof DemoError) throw new ApiError(err.status, err.message);
      throw err;
    }
  }
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      message = body.error ?? message;
      if (body.issues?.length) message += `: ${body.issues.map((i: { path: string[]; message: string }) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) => call<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const del = <T>(path: string) => call<T>(path, { method: "DELETE" });

export type NewAgent = Pick<Agent, "name" | "role" | "personality" | "systemPrompt" | "responsibilities" | "skills" | "avatar" | "buildingId" | "model" | "effort" | "dailyBudgetUsd">;
export type NewSchedule = Pick<Schedule, "name" | "cadence" | "timezone" | "target" | "overlap" | "enabled">;

export const api = {
  snapshot: () => call<TownSnapshot>("/api/snapshot"),
  treasury: () => call<TreasurySummary>("/api/treasury"),
  agentDetail: (id: string) => call<{ agent: Agent; tasks: Task[]; events: TownEvent[] }>(`/api/agents/${id}`),
  updateAgent: (id: string, body: Partial<Agent>) => patch<Agent>(`/api/agents/${id}`, body),
  taskDetail: (id: string) => call<{ task: Task; events: TownEvent[] }>(`/api/tasks/${id}`),
  createTask: (body: { agentId: string; title: string; instructions: string; priority: number; dependsOn?: string[] }) => post<Task>("/api/tasks", body),
  cancelTask: (id: string) => post<{ ok: true }>(`/api/tasks/${id}/cancel`, {}),
  retryTask: (id: string) => post<{ ok: true }>(`/api/tasks/${id}/retry`, {}),
  startCampaign: (body: { topic: string; audience?: string; goal?: string; managerId?: string; researcherId?: string; copywriterId?: string }) => post<Workflow>("/api/workflows/campaign", body),
  hireAgent: (body: NewAgent) => post<Agent>("/api/agents", body),
  archiveAgent: (id: string) => del<{ ok: true }>(`/api/agents/${id}`),
  restoreAgent: (id: string) => post<Agent>(`/api/agents/${id}/restore`, {}),
  createBuilding: (body: Omit<Building, "id">) => post<Building>("/api/buildings", body),
  updateBuilding: (id: string, body: Partial<Omit<Building, "id">>) => patch<Building>(`/api/buildings/${id}`, body),
  deleteBuilding: (id: string) => del<{ ok: true }>(`/api/buildings/${id}`),
  createSchedule: (body: NewSchedule) => post<Schedule>("/api/schedules", body),
  updateSchedule: (id: string, body: Partial<NewSchedule>) => patch<Schedule>(`/api/schedules/${id}`, body),
  deleteSchedule: (id: string) => del<{ ok: true }>(`/api/schedules/${id}`),
  runSchedule: (id: string) => post<{ fired: boolean; outcome: string }>(`/api/schedules/${id}/run`, {}),
  testConnection: () => post<Verification>("/api/system/test-connection", {}),
  decide: (id: string, approve: boolean, note?: string) => post<{ ok: true }>(`/api/approvals/${id}/decide`, { approve, note: note || null }),
  updateSettings: (body: Partial<TownSettings>) => patch<TownSettings>("/api/settings", body),
};

/**
 * Live event stream over SSE, implemented with fetch so the bearer token can be
 * sent as a header. Reconnects with backoff and resumes from the last event id.
 */
export function subscribe(
  onEvent: (e: TownEvent) => void,
  onStatus: (s: "connecting" | "live" | "offline") => void,
  getLastId: () => number,
): () => void {
  if (DEMO) return demoSubscribe(onEvent, onStatus);
  let stopped = false;
  let controller: AbortController | null = null;
  let attempt = 0;

  const run = async () => {
    while (!stopped) {
      onStatus("connecting");
      controller = new AbortController();
      try {
        const token = getToken();
        const lastId = getLastId();
        const res = await fetch(`/api/stream${lastId ? `?since=${lastId}` : ""}`, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        onStatus("live");
        attempt = 0;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            let event = "message";
            let data = "";
            for (const line of chunk.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (event === "town" && data) onEvent(JSON.parse(data) as TownEvent);
          }
        }
      } catch {
        /* fall through to reconnect */
      }
      if (stopped) break;
      onStatus("offline");
      attempt += 1;
      await new Promise((r) => setTimeout(r, Math.min(15000, 500 * 2 ** attempt)));
    }
  };
  void run();
  return () => {
    stopped = true;
    controller?.abort();
  };
}
