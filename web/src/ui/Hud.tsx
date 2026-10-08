import { useEffect, useRef } from "react";
import { eventListeners, useTown, type PanelId, type TimeOfDay } from "../state/store";
import { useTheme } from "../theme-engine/ThemeContext";
import { fmtTokens, fmtUsd } from "./common";

export function TopBar() {
  const theme = useTheme();
  const icons = theme.ui.icons;
  const s = useTown();
  const snap = s.snapshot;
  if (!snap) return null;
  const agents = snap.agents.filter((a) => a.enabled);
  const working = agents.filter((a) => ["working", "planning", "delivering"].includes(a.status)).length;
  const waiting = snap.approvals.filter((a) => a.status === "pending").length;
  const activeTasks = snap.tasks.filter((t) => ["queued", "running", "waiting_approval", "retry_wait"].includes(t.status)).length;
  const errors = snap.tasks.filter((t) => t.status === "failed").length;
  const tokens = snap.stats.reduce((n, x) => n + x.inputTokens + x.outputTokens, 0);
  const cost = snap.stats.reduce((n, x) => n + x.costUsd, 0);
  const times: TimeOfDay[] = ["dawn", "day", "dusk", "night"];

  return (
    <div className="topbar">
      <div className="town-card panel">
        <div className="town-title">
          <span className="town-emblem">🏡</span>
          <div>
            <b>{snap.settings.townName}</b>
            <small>
              {agents.length} villagers · {snap.buildings.length} buildings
            </small>
          </div>
        </div>
        <div className="stat-chips">
          <span className="chip">
            <i className="dot status-working" />
            {working} working
          </span>
          <span className="chip" onClick={() => s.openPanel("approvals")} role="button">
            <i className="dot status-waiting_approval" />
            {waiting} waiting
          </span>
          <span className="chip">
            <i className="dot status-failed" />
            {errors} errors
          </span>
          <span className="chip">📋 {activeTasks} tasks</span>
          <span className="chip" onClick={() => s.openPanel("treasury")} role="button" title="Real API usage only">
            🪙 {fmtTokens(tokens)} · {fmtUsd(cost)}
          </span>
          <span className={`chip conn conn-${s.connection}`} title="Live event stream">
            <i className="dot" />
            {s.connection === "live" ? "LIVE" : s.connection === "connecting" ? "…" : "OFFLINE"}
          </span>
        </div>
      </div>

      <div className="world-controls panel">
        <div className="seg">
          {times.map((t) => (
            <button key={t} className={s.timeOfDay === t ? "on" : ""} onClick={() => s.setTimeOfDay(t)} title={t}>
              {icons[t]}
            </button>
          ))}
        </div>
        <button className="pill" onClick={s.requestOverview} title="Fly back to the town overview">
          {icons.overview} Overview
        </button>
        <button className={`pill ${s.follow ? "on" : ""}`} disabled={!s.selectedAgentId} onClick={() => s.toggle("follow")} title="Camera follows the selected villager">
          {icons.follow} Follow
        </button>
        <button className={`pill ${s.showNames ? "on" : ""}`} onClick={() => s.toggle("showNames")}>
          {icons.names} Names
        </button>
        <button className={`pill ${s.showBubbles ? "on" : ""}`} onClick={() => s.toggle("showBubbles")}>
          {icons.bubbles} Bubbles
        </button>
        <button className={`pill ${s.sound ? "on" : ""}`} onClick={() => s.toggle("sound")} title="Sound effects">
          {s.sound ? icons.soundOn : icons.soundOff}
        </button>
      </div>
    </div>
  );
}

const DOCK: { id: PanelId; label: string }[] = [
  { id: "new-project", label: "New project" },
  { id: "tasks", label: "Task board" },
  { id: "projects", label: "Deliverables" },
  { id: "log", label: "Activity log" },
  { id: "approvals", label: "Approvals" },
  { id: "treasury", label: "Treasury" },
  { id: "settings", label: "Settings" },
];

export function Dock() {
  const theme = useTheme();
  const panel = useTown((s) => s.panel);
  const open = useTown((s) => s.openPanel);
  const pending = useTown((s) => s.snapshot?.approvals.filter((a) => a.status === "pending").length ?? 0);
  const delivered = useTown((s) => s.snapshot?.workflows.filter((w) => w.status === "completed").length ?? 0);
  return (
    <nav className="dock panel">
      {DOCK.map((d) => (
        <button key={d.id} className={`dock-btn ${panel === d.id ? "on" : ""}`} onClick={() => open(d.id)} title={d.label}>
          <span className="dock-icon">{theme.ui.icons[d.id]}</span>
          <span className="dock-label">{d.label}</span>
          {d.id === "approvals" && pending > 0 && <span className="dock-badge">{pending}</span>}
          {d.id === "projects" && delivered > 0 && <span className="dock-badge soft">{delivered}</span>}
        </button>
      ))}
    </nav>
  );
}

export function ProviderBanner() {
  const status = useTown((s) => s.snapshot?.status);
  const open = useTown((s) => s.openPanel);
  if (!status) return null;
  if (status.provider.mode === "live") return null;
  return (
    <div className={`banner banner-${status.provider.mode}`} onClick={() => open("settings")} role="button">
      {status.provider.mode === "simulation" ? (
        <>
          🧪 <b>Simulation mode</b> — no AI model is called. Agent outputs are labelled placeholders. Add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> for real work.
        </>
      ) : (
        <>
          🔑 <b>No API key configured</b> — villagers can't work yet. Add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> on the server and restart.
        </>
      )}
    </div>
  );
}

export function Toasts() {
  const toasts = useTown((s) => s.toasts);
  const dismiss = useTown((s) => s.dismissToast);
  const select = useTown((s) => s.selectAgent);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast tone-${t.tone}`}
          onClick={() => {
            if (t.agentId) select(t.agentId);
            dismiss(t.id);
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Plays theme sound effects for real events (only when the user enabled sound). */
export function useSoundEffects() {
  const theme = useTheme();
  const sound = useTown((s) => s.sound);
  const ctx = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!sound || !theme.audio.playSfx) return;
    const play = theme.audio.playSfx;
    ctx.current ??= new AudioContext();
    const listener = (e: { type: string }) => {
      const c = ctx.current!;
      if (c.state === "suspended") void c.resume();
      const map: Record<string, Parameters<typeof play>[0]> = {
        "task.started": "start",
        "task.completed": "complete",
        "workflow.completed": "complete",
        "task.failed": "fail",
        "task.approval_requested": "approval",
        "task.handoff": "handoff",
      };
      const id = map[e.type];
      if (id) play(id, c);
    };
    eventListeners.add(listener);
    play("open", ctx.current);
    return () => void eventListeners.delete(listener);
  }, [sound, theme]);
}
