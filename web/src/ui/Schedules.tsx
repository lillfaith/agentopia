import { useEffect, useState } from "react";
import type { Cadence, Schedule, TreasurySummary, Weekday } from "../../../shared/types";
import { api } from "../api/client";
import { useTown } from "../state/store";
import { useTheme } from "../theme-engine/ThemeContext";
import { AgentName, Badge, Drawer, Empty, fmtUsd, timeAgo } from "./common";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function describe(c: Cadence): string {
  if (c.kind === "interval") return c.everyMinutes % 60 === 0 ? `Every ${c.everyMinutes / 60} h` : `Every ${c.everyMinutes} min`;
  if (c.kind === "daily") return `Daily at ${c.time}`;
  return `${[...c.days].sort().map((d) => DAYS[d - 1]).join(", ")} at ${c.time}`;
}

function localTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const ms = d.getTime() - Date.now();
  const rel = ms > 0 ? (ms < 3600_000 ? `in ${Math.round(ms / 60_000)} min` : ms < 86_400_000 ? `in ${Math.round(ms / 3600_000)} h` : `in ${Math.round(ms / 86_400_000)} d`) : timeAgo(iso);
  return `${d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} (${rel})`;
}

export function SchedulesPanel() {
  const theme = useTheme();
  const snap = useTown((s) => s.snapshot)!;
  const close = useTown((s) => s.openPanel);
  const push = useTown((s) => s.pushToast);
  const [treasury, setTreasury] = useState<TreasurySummary | null>(null);
  const lastEvent = snap.events.at(-1)?.id ?? 0;
  useEffect(() => {
    api.treasury().then(setTreasury, () => {});
  }, [lastEvent]);
  const projection = (id: string) => treasury?.scheduleProjections.find((p) => p.scheduleId === id);
  const total = treasury?.scheduleProjections.reduce((a, p) => a + (p.projectedMonthlyUsd ?? 0), 0) ?? 0;
  const workerAlive = snap.status.workers.some((w) => w.alive);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) push({ tone: "good", text: ok });
    } catch (e) {
      push({ tone: "bad", text: errText(e) });
    }
  };

  return (
    <Drawer side="left" title="Schedules" icon={theme.ui.icons.schedules} onClose={() => close(null)} wide>
      <p className="muted small">
        Recurring work runs on the server's worker — your browser can be closed. Missed runs (e.g. while the server was off) fire once when it comes back. Runs are skipped while the previous run is still going or a budget limit is reached.
      </p>
      {!workerAlive && <div className="warn-box">No worker is running right now, so schedules won't fire. Start the server (or `npm run worker`).</div>}
      {!snap.schedules.length && <Empty>No schedules yet. Create one below ⏰</Empty>}
      {snap.schedules.map((s) => {
        const p = projection(s.id);
        return (
          <section key={s.id} className={`card schedule ${s.enabled ? "" : "paused"}`}>
            <div className="row between">
              <b>⏰ {s.name}</b>
              <span className="row gap-s">
                <Badge tone={s.enabled ? "good" : "muted"}>{s.enabled ? "active" : "paused"}</Badge>
                {s.target.type === "campaign" ? <Badge tone="accent">project</Badge> : <AgentName id={s.target.agentId} />}
              </span>
            </div>
            <small>
              {describe(s.cadence)} · {s.timezone} · next: <b>{s.enabled ? localTime(s.nextRunAt) : "paused"}</b>
            </small>
            <small className="muted">
              {s.target.type === "task" ? `“${s.target.title}”` : `Campaign: ${s.target.topic}`} · ran {s.runCount}× · last: {s.lastRunAt ? `${s.lastOutcome} (${timeAgo(s.lastRunAt)})` : "never"}
            </small>
            {p && (
              <small className="muted">
                💰 ~{p.runsPerMonth} runs/month ·{" "}
                {p.avgRunCostUsd === null ? "projected cost appears after the first real run" : `avg ${fmtUsd(p.avgRunCostUsd)}/run → ~${fmtUsd(p.projectedMonthlyUsd ?? 0)}/month`}
              </small>
            )}
            <div className="row gap-s">
              <button className="btn ghost" onClick={() => void act(() => api.runSchedule(s.id), "Started")}>
                ▶ Run now
              </button>
              <button className="btn ghost" onClick={() => void act(() => api.updateSchedule(s.id, { enabled: !s.enabled }))}>
                {s.enabled ? "⏸ Pause" : "▶ Resume"}
              </button>
              <button className="btn ghost danger" onClick={() => confirm(`Delete “${s.name}”?`) && void act(() => api.deleteSchedule(s.id))}>
                Delete
              </button>
            </div>
          </section>
        );
      })}
      {snap.schedules.length > 0 && treasury && <p className="small muted">Projected schedule spend: ~{fmtUsd(total)}/month (from recent real runs). Budget limits still apply.</p>}
      <NewSchedule />
    </Drawer>
  );
}

function NewSchedule() {
  const snap = useTown((s) => s.snapshot)!;
  const push = useTown((s) => s.pushToast);
  const agents = snap.agents.filter((a) => a.enabled && !a.archived);
  const minInterval = snap.status.limits.minScheduleIntervalMinutes;
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [f, setF] = useState({
    name: "",
    kind: "daily" as Cadence["kind"],
    time: "09:00",
    days: [1, 2, 3, 4, 5] as Weekday[],
    everyMinutes: 60,
    timezone: snap.settings.timezone !== "UTC" ? snap.settings.timezone : browserTz,
    targetType: "task" as "task" | "campaign",
    agentId: agents[0]?.id ?? "",
    title: "",
    instructions: "",
    priority: 1,
    topic: "",
    audience: "",
    overlap: "skip" as Schedule["overlap"],
  });
  const [busy, setBusy] = useState(false);
  const cadence = (): Cadence => (f.kind === "interval" ? { kind: "interval", everyMinutes: f.everyMinutes } : f.kind === "daily" ? { kind: "daily", time: f.time } : { kind: "weekly", days: f.days, time: f.time });

  const submit = async () => {
    setBusy(true);
    try {
      await api.createSchedule({
        name: f.name.trim() || (f.targetType === "task" ? f.title.trim() : `Campaign: ${f.topic.trim()}`),
        cadence: cadence(),
        timezone: f.timezone,
        overlap: f.overlap,
        enabled: true,
        target:
          f.targetType === "task"
            ? { type: "task", agentId: f.agentId, title: f.title.trim(), instructions: f.instructions.trim() || f.title.trim(), priority: f.priority as 0 }
            : { type: "campaign", topic: f.topic.trim(), audience: f.audience.trim(), goal: "" },
      });
      push({ tone: "good", text: "Schedule created ⏰" });
      setF({ ...f, name: "", title: "", instructions: "", topic: "", audience: "" });
    } catch (e) {
      push({ tone: "bad", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const valid = f.targetType === "task" ? !!f.agentId && !!f.title.trim() : f.topic.trim().length >= 3;

  return (
    <section className="card composer form">
      <h3>➕ New schedule</h3>
      <div className="seg-row">
        <button className={`pill ${f.targetType === "task" ? "on" : ""}`} onClick={() => setF({ ...f, targetType: "task" })}>
          A task for one villager
        </button>
        <button className={`pill ${f.targetType === "campaign" ? "on" : ""}`} onClick={() => setF({ ...f, targetType: "campaign" })}>
          A whole marketing project
        </button>
      </div>
      {f.targetType === "task" ? (
        <>
          <div className="grid2">
            <label>
              Villager
              <select value={f.agentId} onChange={(e) => setF({ ...f, agentId: e.target.value })}>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.role}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) })}>
                {["low", "normal", "high", "urgent"].map((p, i) => (
                  <option key={p} value={i}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <input placeholder="Task title, e.g. Morning industry news digest" value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <textarea rows={3} placeholder="Instructions" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />
        </>
      ) : (
        <>
          <input placeholder="Product or topic" value={f.topic} maxLength={500} onChange={(e) => setF({ ...f, topic: e.target.value })} />
          <input placeholder="Audience (optional)" value={f.audience} maxLength={500} onChange={(e) => setF({ ...f, audience: e.target.value })} />
        </>
      )}
      <div className="grid2">
        <label>
          Repeat
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Cadence["kind"] })}>
            <option value="daily">Every day</option>
            <option value="weekly">On certain weekdays</option>
            <option value="interval">Every N minutes</option>
          </select>
        </label>
        {f.kind === "interval" ? (
          <label>
            Every (minutes, ≥ {minInterval})
            <input type="number" min={minInterval} step={15} value={f.everyMinutes} onChange={(e) => setF({ ...f, everyMinutes: Number(e.target.value) })} />
          </label>
        ) : (
          <label>
            At (local time)
            <input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
          </label>
        )}
      </div>
      {f.kind === "weekly" && (
        <div className="row gap-s">
          {DAYS.map((d, i) => {
            const day = (i + 1) as Weekday;
            const on = f.days.includes(day);
            return (
              <button key={d} className={`pill ${on ? "on" : ""}`} onClick={() => setF({ ...f, days: on ? f.days.filter((x) => x !== day) : [...f.days, day] })}>
                {d}
              </button>
            );
          })}
        </div>
      )}
      <div className="grid2">
        <label>
          Timezone (IANA)
          <input value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} placeholder="e.g. America/New_York" />
        </label>
        <label>
          If the last run is still going
          <select value={f.overlap} onChange={(e) => setF({ ...f, overlap: e.target.value as Schedule["overlap"] })}>
            <option value="skip">Skip this run</option>
            <option value="queue">Queue another anyway</option>
          </select>
        </label>
      </div>
      <input placeholder="Schedule name (optional)" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <button className="btn primary" disabled={busy || !valid || (f.kind === "weekly" && !f.days.length)} onClick={submit}>
        Create schedule
      </button>
    </section>
  );
}
