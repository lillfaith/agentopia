import { useMemo, useState } from "react";
import type { Task, TaskStatus } from "../../../shared/types";
import { PRIORITY_LABELS } from "../../../shared/types";
import { api } from "../api/client";
import { STATUS_LABEL, useTown } from "../state/store";
import { useTheme } from "../theme-engine/ThemeContext";
import { TaskOutputCard } from "./AgentPanel";
import { AgentName, Badge, Drawer, Empty, EventBadge, ExecutionBadge, ExecutionProof, Markdown, SimTag, StatusDot, TASK_LABEL, TASK_TONE, clock, timeAgo } from "./common";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ───────────────────────── building ─────────────────────────

export function BuildingPanel({ buildingId }: { buildingId: string }) {
  const snap = useTown((s) => s.snapshot)!;
  const select = useTown((s) => s.selectBuilding);
  const selectAgent = useTown((s) => s.selectAgent);
  const b = snap.buildings.find((x) => x.id === buildingId);
  if (!b) return null;
  const residents = snap.agents.filter((a) => a.buildingId === b.id);
  const ids = new Set(residents.map((a) => a.id));
  const tasks = snap.tasks.filter((t) => ids.has(t.agentId)).slice(0, 12);
  return (
    <Drawer side="right" title={b.name} icon="🏠" onClose={() => select(null)}>
      <p className="muted">
        <b>{b.department}</b> — {b.description}
      </p>
      <section className="card">
        <h3>Who works here</h3>
        {residents.map((a) => (
          <button key={a.id} className="resident" onClick={() => selectAgent(a.id)}>
            <span className="avatar-dot big" style={{ background: a.avatar.color }} />
            <span>
              <b>{a.name}</b> <small className="muted">{a.role}</small>
              <br />
              <small>
                <StatusDot status={a.status} /> {a.statusDetail ?? STATUS_LABEL[a.status]}
              </small>
            </span>
          </button>
        ))}
      </section>
      <section className="card">
        <h3>Recent work</h3>
        <ul className="task-mini">
          {tasks.map((t) => (
            <li key={t.id}>
              <span>{t.title}</span>
              <Badge tone={TASK_TONE[t.status]}>{TASK_LABEL[t.status]}</Badge>
            </li>
          ))}
          {!tasks.length && <li className="muted">No tasks yet.</li>}
        </ul>
      </section>
    </Drawer>
  );
}

// ───────────────────────── task board ─────────────────────────

const COLUMNS: { title: string; statuses: TaskStatus[] }[] = [
  { title: "Up next", statuses: ["queued", "blocked", "retry_wait"] },
  { title: "In progress", statuses: ["running", "waiting_approval"] },
  { title: "Done", statuses: ["completed"] },
  { title: "Problems", statuses: ["failed", "cancelled"] },
];

export function TaskBoard() {
  const theme = useTheme();
  const snap = useTown((s) => s.snapshot)!;
  const close = useTown((s) => s.openPanel);
  const [selected, setSelected] = useState<Task | null>(null);
  const [agentFilter, setAgentFilter] = useState("");
  const tasks = snap.tasks.filter((t) => !agentFilter || t.agentId === agentFilter);
  return (
    <Drawer side="left" title="Task board" icon={theme.ui.icons.tasks} onClose={() => close(null)} wide>
      <NewTaskForm />
      <div className="row between">
        <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
          <option value="">All villagers</option>
          {snap.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.role})
            </option>
          ))}
        </select>
        <small className="muted">{tasks.length} tasks</small>
      </div>
      <div className="kanban">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => col.statuses.includes(t.status));
          return (
            <div key={col.title} className="kanban-col">
              <h4>
                {col.title} <span className="muted">{items.length}</span>
              </h4>
              {items.map((t) => (
                <button key={t.id} className={`task-card ${selected?.id === t.id ? "on" : ""}`} onClick={() => setSelected(t)}>
                  <b>{t.title}</b>
                  <div className="row between">
                    <AgentName id={t.agentId} />
                    <Badge tone={TASK_TONE[t.status]}>{TASK_LABEL[t.status]}</Badge>
                  </div>
                  <div className="row gap-s">
                    {t.priority >= 2 && <Badge tone="bad">{PRIORITY_LABELS[t.priority]}</Badge>}
                    {t.dependsOn.length > 0 && <small className="muted">⛓ {t.dependsOn.length} dep</small>}
                    {t.createdBy.startsWith("schedule:") ? (
                      <small className="muted">⏰ scheduled</small>
                    ) : (
                      t.createdBy !== "user" && <small className="muted">from {snap.agents.find((a) => a.id === t.createdBy)?.name ?? t.createdBy}</small>
                    )}
                    <ExecutionBadge task={t} />
                  </div>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {selected && <TaskDetail taskId={selected.id} onClose={() => setSelected(null)} />}
    </Drawer>
  );
}

function TaskDetail({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const snap = useTown((s) => s.snapshot)!;
  const push = useTown((s) => s.pushToast);
  const task = snap.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  const events = snap.events.filter((e) => e.taskId === task.id && e.type !== "agent.status");
  const deps = task.dependsOn.map((id) => snap.tasks.find((t) => t.id === id)).filter(Boolean) as Task[];
  return (
    <section className="card task-detail">
      <div className="row between">
        <h3>{task.title}</h3>
        <button className="icon-btn" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="row gap-s">
        <AgentName id={task.agentId} />
        <Badge tone={TASK_TONE[task.status]}>{TASK_LABEL[task.status]}</Badge>
        <small className="muted">
          attempt {task.attempts}/{task.maxAttempts} · created {timeAgo(task.createdAt)}
        </small>
      </div>
      <details>
        <summary>Instructions</summary>
        <Markdown text={task.instructions} />
      </details>
      {deps.length > 0 && (
        <p className="muted">
          Depends on: {deps.map((d) => `${d.title} (${TASK_LABEL[d.status]})`).join(", ")}
        </p>
      )}
      {task.lastError && <div className="error-box">{task.lastError}</div>}
      <ExecutionProof task={task} />
      {task.simulated && <SimTag on />}
      {task.output && (
        <details open>
          <summary>Output</summary>
          <Markdown text={task.output} />
        </details>
      )}
      <details>
        <summary>Execution log ({events.length})</summary>
        <ul className="live-feed">
          {events.map((e) => (
            <li key={e.id}>
              <small className="muted">{clock(e.ts)}</small> <EventBadge e={e} /> {e.message}
            </li>
          ))}
        </ul>
      </details>
      <div className="row gap-s">
        {!["completed", "failed", "cancelled"].includes(task.status) && (
          <button className="btn ghost danger" onClick={() => api.cancelTask(task.id).catch((e) => push({ tone: "bad", text: errText(e) }))}>
            ■ Cancel
          </button>
        )}
        {(task.status === "failed" || task.status === "cancelled") && (
          <button className="btn ghost" onClick={() => api.retryTask(task.id).catch((e) => push({ tone: "bad", text: errText(e) }))}>
            ↻ Retry
          </button>
        )}
      </div>
    </section>
  );
}

function NewTaskForm() {
  const snap = useTown((s) => s.snapshot)!;
  const push = useTown((s) => s.pushToast);
  const agents = snap.agents.filter((a) => a.enabled);
  const open = snap.tasks.filter((t) => !["failed", "cancelled"].includes(t.status)).slice(0, 30);
  const [form, setForm] = useState({ agentId: agents[0]?.id ?? "", title: "", instructions: "", priority: 1, dependsOn: "" });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.createTask({
        agentId: form.agentId,
        title: form.title.trim(),
        instructions: form.instructions.trim() || form.title.trim(),
        priority: form.priority,
        dependsOn: form.dependsOn ? [form.dependsOn] : [],
      });
      setForm((f) => ({ ...f, title: "", instructions: "", dependsOn: "" }));
      push({ tone: "info", text: "Task assigned" });
    } catch (e) {
      push({ tone: "bad", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="card composer">
      <summary>➕ Assign a new task</summary>
      <div className="grid2">
        <label>
          Villager
          <select value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {a.role}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}>
            {[0, 1, 2, 3].map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p as 0]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <input placeholder="Title" value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <textarea placeholder="Instructions" rows={3} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
      <label>
        Wait for (dependency, optional) — its output is passed in automatically
        <select value={form.dependsOn} onChange={(e) => setForm({ ...form, dependsOn: e.target.value })}>
          <option value="">— none —</option>
          {open.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} ({TASK_LABEL[t.status]})
            </option>
          ))}
        </select>
      </label>
      <button className="btn primary" disabled={busy || !form.title.trim() || !form.agentId} onClick={submit}>
        Assign
      </button>
    </details>
  );
}

// ───────────────────────── new project (workflow) ─────────────────────────

export function NewProject() {
  const theme = useTheme();
  const close = useTown((s) => s.openPanel);
  const push = useTown((s) => s.pushToast);
  const status = useTown((s) => s.snapshot!.status);
  const agents = useTown((s) => s.snapshot!.agents.filter((a) => a.enabled && !a.archived));
  const byRole = (role: string, fallbackId: string) => agents.find((a) => a.id === fallbackId)?.id ?? agents.find((a) => a.role.toLowerCase().includes(role))?.id ?? agents[0]?.id ?? "";
  const [form, setForm] = useState({ topic: "", audience: "", goal: "" });
  const [team, setTeam] = useState(() => ({ managerId: byRole("manager", "manager"), researcherId: byRole("research", "researcher"), copywriterId: byRole("writ", "copywriter") }));
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.startCampaign({ ...form, ...team });
      push({ tone: "good", text: "Project started — watch Mabel write the brief!" });
      close(null);
      useTown.getState().requestOverview();
    } catch (e) {
      push({ tone: "bad", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer side="left" title="New marketing project" icon={theme.ui.icons["new-project"]} onClose={() => close(null)}>
      <div className="flow">
        <span>👑 Mabel writes the brief</span>→<span>🔭 Pip researches</span>→<span>🪶 Quill writes copy</span>→<span>👑 Mabel reviews</span>→<span>🎁 Deliverable</span>
      </div>
      <p className="muted">
        Four real tasks are queued with dependencies. Each agent's output is handed to the next automatically, and you'll see them walk it over in the town.
      </p>
      {status.provider.mode === "unconfigured" && <div className="error-box">No API key configured — the first task will fail until ANTHROPIC_API_KEY is set on the server.</div>}
      {status.provider.mode === "simulation" && <div className="warn-box">Simulation mode: outputs will be labelled placeholders, not real AI work.</div>}
      <div className="stack form">
        <label>
          Product or topic *
          <input placeholder="e.g. A lavender oat-milk latte for our café" value={form.topic} maxLength={500} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
        </label>
        <label>
          Target audience
          <input placeholder="e.g. Remote workers aged 25–40 in Portland" value={form.audience} maxLength={500} onChange={(e) => setForm({ ...form, audience: e.target.value })} />
        </label>
        <label>
          Goal
          <textarea rows={2} placeholder="e.g. Drive weekday afternoon visits" value={form.goal} maxLength={1000} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
        </label>
        <fieldset>
          <legend>Team</legend>
          <div className="grid2">
            {(
              [
                ["managerId", "Brief & review"],
                ["researcherId", "Research"],
                ["copywriterId", "Copywriting"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <select value={team[key]} onChange={(e) => setTeam({ ...team, [key]: e.target.value })}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {a.role}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </fieldset>
        <button className="btn primary full" disabled={busy || form.topic.trim().length < 3 || !team.managerId || !team.researcherId || !team.copywriterId} onClick={submit}>
          ✨ Start project
        </button>
      </div>
    </Drawer>
  );
}

// ───────────────────────── deliverables ─────────────────────────

export function Projects() {
  const theme = useTheme();
  const snap = useTown((s) => s.snapshot)!;
  const close = useTown((s) => s.openPanel);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Drawer side="left" title="Projects & deliverables" icon={theme.ui.icons.projects} onClose={() => close(null)} wide>
      {!snap.workflows.length && <Empty>No projects yet. Start one with ✨ New project.</Empty>}
      {snap.workflows.map((w) => {
        const steps = snap.tasks.filter((t) => t.workflowId === w.id).reverse();
        const final = snap.tasks.find((t) => t.id === w.finalTaskId);
        const done = steps.filter((t) => t.status === "completed").length;
        return (
          <section key={w.id} className="card">
            <div className="row between">
              <h3>{w.title}</h3>
              <Badge tone={w.status === "completed" ? "good" : w.status === "running" ? "accent" : "bad"}>{w.status}</Badge>
            </div>
            <div className="steps">
              {steps.map((t) => (
                <span key={t.id} className={`step tone-${TASK_TONE[t.status]}`} title={`${t.title} — ${TASK_LABEL[t.status]}`}>
                  <AgentName id={t.agentId} />
                </span>
              ))}
              <small className="muted">
                {done}/{steps.length} steps · {timeAgo(w.createdAt)}
              </small>
            </div>
            {final?.status === "completed" && <TaskOutputCard task={final} open={open === w.id} onToggle={() => setOpen(open === w.id ? null : w.id)} />}
          </section>
        );
      })}
    </Drawer>
  );
}

// ───────────────────────── activity log ─────────────────────────

const HIDDEN_BY_DEFAULT = new Set(["agent.status", "usage.recorded"]);

export function ActivityLog() {
  const theme = useTheme();
  const snap = useTown((s) => s.snapshot)!;
  const close = useTown((s) => s.openPanel);
  const [agent, setAgent] = useState("");
  const [verbose, setVerbose] = useState(false);
  const [q, setQ] = useState("");
  const events = useMemo(
    () =>
      snap.events
        .filter((e) => (verbose || !HIDDEN_BY_DEFAULT.has(e.type)) && (!agent || e.agentId === agent) && (!q || e.message.toLowerCase().includes(q.toLowerCase())))
        .slice()
        .reverse(),
    [snap.events, agent, verbose, q],
  );
  return (
    <Drawer side="left" title="Execution log" icon={theme.ui.icons.log} onClose={() => close(null)} wide>
      <div className="row gap-s">
        <select value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">All agents</option>
          {snap.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check inline">
          <input type="checkbox" checked={verbose} onChange={(e) => setVerbose(e.target.checked)} /> verbose
        </label>
      </div>
      <table className="log-table">
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="muted mono">{clock(e.ts)}</td>
              <td>{e.agentId ? <AgentName id={e.agentId} /> : <span className="muted">town</span>}</td>
              <td>
                <EventBadge e={e} />
              </td>
              <td>
                {e.message} {e.simulated && <SimTag on />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!events.length && <Empty>No events yet.</Empty>}
      <p className="muted small">Persisted in the server database (events table) · newest first · last 500 shown.</p>
    </Drawer>
  );
}

// ───────────────────────── approvals & notifications ─────────────────────────

export function ApprovalsPanel() {
  const theme = useTheme();
  const snap = useTown((s) => s.snapshot)!;
  const close = useTown((s) => s.openPanel);
  const push = useTown((s) => s.pushToast);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const pending = snap.approvals.filter((a) => a.status === "pending");
  const decided = snap.approvals.filter((a) => a.status !== "pending").slice(0, 15);
  const notices = snap.events.filter((e) => ["task.completed", "task.failed", "workflow.completed", "system.notice"].includes(e.type)).slice(-20).reverse();
  const decide = async (id: string, approve: boolean) => {
    try {
      await api.decide(id, approve, notes[id]);
    } catch (e) {
      push({ tone: "bad", text: errText(e) });
    }
  };
  return (
    <Drawer side="left" title="Approvals & notifications" icon={theme.ui.icons.approvals} onClose={() => close(null)}>
      <p className="muted small">Publishing, external communication, spending, deployment and destructive actions always wait here for you.</p>
      <h3>Waiting for you ({pending.length})</h3>
      {!pending.length && <Empty>Nothing needs your approval. 🌸</Empty>}
      {pending.map((a) => {
        const input = a.input as Record<string, unknown> | null;
        return (
          <section key={a.id} className="card approval">
            <div className="row between">
              <b>{a.summary}</b>
              <AgentName id={a.agentId} />
            </div>
            <small className="muted">
              Tool: <code>{a.toolId}</code> · requested {timeAgo(a.createdAt)}
            </small>
            {input && typeof input.body === "string" ? (
              <details open>
                <summary>Content</summary>
                <Markdown text={input.body} />
              </details>
            ) : (
              <pre className="mono small">{JSON.stringify(a.input, null, 2)}</pre>
            )}
            <input placeholder="Note for the agent (optional)" value={notes[a.id] ?? ""} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
            <div className="row gap-s">
              <button className="btn primary" onClick={() => decide(a.id, true)}>
                ✓ Approve
              </button>
              <button className="btn ghost danger" onClick={() => decide(a.id, false)}>
                ✕ Reject
              </button>
            </div>
          </section>
        );
      })}
      {decided.length > 0 && (
        <>
          <h3>Decided</h3>
          <ul className="task-mini">
            {decided.map((a) => (
              <li key={a.id}>
                <span>{a.summary}</span>
                <Badge tone={a.status === "approved" ? "good" : "bad"}>{a.status}</Badge>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Notifications</h3>
      <ul className="live-feed">
        {notices.map((e) => (
          <li key={e.id}>
            <EventBadge e={e} /> {e.message} <small className="muted">{timeAgo(e.ts)}</small>
          </li>
        ))}
      </ul>
    </Drawer>
  );
}
