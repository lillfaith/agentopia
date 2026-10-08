import { useEffect, useRef } from "react";
import { DEMO, api } from "../api/client";
import { eventListeners, useTown, type PanelId } from "../state/store";
import { TownClock } from "./TownClock";
import { useTheme } from "../theme-engine/ThemeContext";
import { fmtTokens, fmtUsd } from "./common";

export function TopBar() {
  const theme = useTheme();
  const icons = theme.ui.icons;
  const s = useTown();
  const snap = s.snapshot;
  const bar = useRef<HTMLDivElement>(null);
  // Drawers and banners sit below the HUD, whose height changes as status chips wrap.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--hud-top", `${el.getBoundingClientRect().bottom + 10}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!snap]);
  if (!snap) return null;
  const agents = snap.agents.filter((a) => a.enabled && !a.archived);
  const working = agents.filter((a) => ["working", "planning", "delivering"].includes(a.status)).length;
  const waiting = snap.approvals.filter((a) => a.status === "pending").length;
  const activeTasks = snap.tasks.filter((t) => ["queued", "running", "waiting_approval", "retry_wait"].includes(t.status)).length;
  const errors = snap.tasks.filter((t) => t.status === "failed").length;
  const tokens = snap.stats.reduce((n, x) => n + x.inputTokens + x.outputTokens, 0);
  const cost = snap.stats.reduce((n, x) => n + x.costUsd, 0);

  return (
    <div className="topbar" ref={bar}>
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
          <span className="chip" onClick={() => s.openPanel("rewards")} role="button" title="Town coins, earned for verified work. No cash value.">
            ✨ {snap.rewards.balance} coins
          </span>
          {snap.status.budget.globalHold && (
            <span className="chip chip-bad" onClick={() => s.openPanel("settings")} role="button" title="A budget limit was reached; new work is paused">
              ⛔ budget paused
            </span>
          )}
          {snap.settings.paused && (
            <span className="chip chip-bad" title="Emergency stop is on: nothing starts until you resume">
              ⏸ all paused
            </span>
          )}
          {s.account && !s.account.plan.canRun && (
            <span className="chip chip-bad" title={s.account.plan.reason ?? ""}>
              ⛔ plan paused
            </span>
          )}
          {!snap.status.worker.running && !snap.status.workers.some((w) => w.alive) && (
            <span className="chip chip-bad" onClick={() => s.openPanel("settings")} role="button" title="No worker process is running: tasks and schedules are not executing">
              ⚙️ no worker
            </span>
          )}
          {snap.schedules.some((x) => x.enabled) && (
            <span className="chip" onClick={() => s.openPanel("schedules")} role="button">
              ⏰ {snap.schedules.filter((x) => x.enabled).length} scheduled
            </span>
          )}
          <span className={`chip conn conn-${s.connection}`} title="Live event stream">
            <i className="dot" />
            {s.connection === "live" ? "LIVE" : s.connection === "connecting" ? "…" : "OFFLINE"}
          </span>
        </div>
      </div>

      <div className="world-controls panel">
        <TownClock />
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
        {!DEMO && (
          <button
            className={`pill ${snap.settings.paused ? "on" : "danger"}`}
            onClick={() =>
              (snap.settings.paused ? api.resumeAll() : api.emergencyStop()).then(
                () => void s.load(),
                (e) => s.pushToast({ tone: "bad", text: e instanceof Error ? e.message : String(e) }),
              )
            }
            title={snap.settings.paused ? "Let villagers start work again" : "Emergency stop: cancel running tasks and pause all villagers and schedules"}
          >
            {snap.settings.paused ? "▶️ Resume" : "🛑 Stop all"}
          </button>
        )}
        {s.account && (
          <button className="pill" onClick={() => void s.signOut()} title={`Signed in as ${s.account.user.email} · ${s.account.plan.label}`}>
            👤 Sign out
          </button>
        )}
      </div>
    </div>
  );
}

const DOCK: { id: PanelId; label: string }[] = [
  { id: "new-project", label: "New project" },
  { id: "town", label: "Town" },
  { id: "schedules", label: "Schedules" },
  { id: "tasks", label: "Task board" },
  { id: "projects", label: "Deliverables" },
  { id: "log", label: "Activity log" },
  { id: "approvals", label: "Approvals" },
  { id: "rewards", label: "Rewards" },
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
  if (DEMO)
    return (
      <div className="banner banner-simulation">
        🎬 <b>Live demo</b>: a recorded simulation replaying in your browser. No AI is called and nothing is saved to a server. You can still customise villagers in the 👗 wardrobe.
      </div>
    );
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
