import { useEffect, useMemo, useState } from "react";
import type { Agent, Effort, Task } from "../../../shared/types";
import { PRIORITY_LABELS } from "../../../shared/types";
import { api } from "../api/client";
import { STATUS_LABEL, levelFor, statsFor, useTown } from "../state/store";
import { Badge, Drawer, Empty, EventBadge, ExecutionBadge, ExecutionProof, Markdown, StatusDot, TASK_LABEL, TASK_TONE, clock, fmtTokens, fmtUsd, timeAgo } from "./common";
import { SkillPicker } from "./Town";

type Tab = "overview" | "work" | "config";

export function AgentPanel({ agentId }: { agentId: string }) {
  const snap = useTown((s) => s.snapshot)!;
  const select = useTown((s) => s.selectAgent);
  const agent = snap.agents.find((a) => a.id === agentId);
  const [tab, setTab] = useState<Tab>("overview");
  if (!agent) return null;
  const stats = statsFor(snap, agent.id);
  const lv = levelFor(stats);
  const building = snap.buildings.find((b) => b.id === agent.buildingId);

  return (
    <Drawer side="right" title={null} onClose={() => select(null)}>
      <div className="agent-head">
        <div className="agent-avatar" style={{ background: agent.avatar.color }}>
          {agent.name.slice(0, 1)}
        </div>
        <div className="agent-id">
          <h2>{agent.name}</h2>
          <div className="muted">
            {agent.role} · {building?.name ?? agent.buildingId}
          </div>
          <div className="row gap-s">
            <Badge tone="accent">Lv {lv.level}</Badge>
            <span className={`status-pill status-${agent.status}`}>
              <StatusDot status={agent.status} /> {STATUS_LABEL[agent.status]}
            </span>
            {!agent.enabled && <Badge tone="muted">Disabled</Badge>}
          </div>
        </div>
      </div>
      {agent.archived && (
        <div className="warn-box row between">
          <span>{agent.name} has left town (archived). History is kept.</span>
          <button className="btn" onClick={() => api.restoreAgent(agent.id).catch((e) => useTown.getState().pushToast({ tone: "bad", text: String(e) }))}>
            Restore
          </button>
        </div>
      )}
      <div className="xp-bar" title="Cosmetic level derived from completed tasks">
        <div style={{ width: `${Math.min(100, (lv.xp / lv.next) * 100)}%` }} />
        <span>
          {lv.xp} / {lv.next} XP
        </span>
      </div>
      <div className="stat-grid">
        <div>
          <b>{stats.tasksCompleted}</b>
          <small>Tasks done</small>
        </div>
        <div>
          <b>{stats.tasksFailed}</b>
          <small>Failed</small>
        </div>
        <div>
          <b>{fmtTokens(stats.inputTokens + stats.outputTokens)}</b>
          <small>Tokens</small>
        </div>
        <div>
          <b>{fmtUsd(stats.costUsd)}</b>
          <small>Est. cost</small>
        </div>
      </div>
      <div className="tabs">
        {(["overview", "work", "config"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "overview" ? "Now" : t === "work" ? "Work" : "Configure"}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview agent={agent} />}
      {tab === "work" && <WorkHistory agent={agent} />}
      {tab === "config" && <Config agent={agent} key={agent.updatedAt} />}
    </Drawer>
  );
}

function Overview({ agent }: { agent: Agent }) {
  const snap = useTown((s) => s.snapshot)!;
  const tasks = snap.tasks.filter((t) => t.agentId === agent.id);
  const current = tasks.find((t) => t.id === agent.currentTaskId) ?? tasks.find((t) => t.status === "running" || t.status === "waiting_approval");
  const upcoming = tasks.filter((t) => ["queued", "blocked", "retry_wait"].includes(t.status) && t.id !== current?.id).reverse();
  const live = current ? snap.events.filter((e) => e.taskId === current.id && e.type !== "agent.status").slice(-8) : [];
  const recent = snap.events.filter((e) => e.agentId === agent.id && e.type !== "agent.status" && e.type !== "usage.recorded").slice(-6).reverse();
  const [busy, setBusy] = useState(false);

  return (
    <div className="stack">
      <section className="card">
        <h3>Working on</h3>
        {current ? (
          <>
            <div className="row between">
              <b>{current.title}</b>
              <Badge tone={TASK_TONE[current.status]}>{TASK_LABEL[current.status]}</Badge>
            </div>
            <ExecutionBadge task={current} verbose />
            <ul className="live-feed">
              {live.map((e) => (
                <li key={e.id}>
                  <EventBadge e={e} /> <span>{e.message}</span>
                </li>
              ))}
              {!live.length && <li className="muted">Starting…</li>}
            </ul>
            {current.status === "waiting_approval" && (
              <button className="btn warn full" onClick={() => useTown.getState().openPanel("approvals")}>
                🔔 Review the pending approval
              </button>
            )}
            <button
              className="btn ghost danger full"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.cancelTask(current.id);
                } catch (err) {
                  useTown.getState().pushToast({ tone: "bad", text: String(err) });
                } finally {
                  setBusy(false);
                }
              }}
            >
              ■ Stop task
            </button>
          </>
        ) : (
          <Empty>{agent.name} is free. Assign something below ✨</Empty>
        )}
      </section>

      {upcoming.length > 0 && (
        <section className="card">
          <h3>Queue</h3>
          <ul className="task-mini">
            {upcoming.map((t) => (
              <li key={t.id}>
                <span>{t.title}</span>
                <Badge tone={TASK_TONE[t.status]}>{TASK_LABEL[t.status]}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h3>Recent activity</h3>
        <ul className="live-feed">
          {recent.map((e) => (
            <li key={e.id}>
              <EventBadge e={e} /> <span>{e.message}</span> <small className="muted">{timeAgo(e.ts)}</small>
            </li>
          ))}
          {!recent.length && <li className="muted">Nothing yet.</li>}
        </ul>
      </section>

      <AssignTask agent={agent} />
    </div>
  );
}

export function AssignTask({ agent }: { agent: Agent }) {
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [priority, setPriority] = useState(1);
  const [busy, setBusy] = useState(false);
  const push = useTown((s) => s.pushToast);
  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api.createTask({ agentId: agent.id, title: title.trim(), instructions: instructions.trim() || title.trim(), priority });
      setTitle("");
      setInstructions("");
      push({ tone: "info", text: `Assigned to ${agent.name}` });
    } catch (err) {
      push({ tone: "bad", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card composer">
      <h3>Assign a task to {agent.name}</h3>
      <input placeholder={`e.g. ${agent.role === "Researcher" ? "Research eco-friendly packaging trends" : agent.role === "Copywriter" ? "Write 3 taglines for our bakery" : "Plan a product launch"}`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submit()} />
      <textarea placeholder="Details, context, constraints (optional)" value={instructions} rows={3} onChange={(e) => setInstructions(e.target.value)} />
      <div className="row between">
        <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
          {[0, 1, 2, 3].map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p as 0]} priority
            </option>
          ))}
        </select>
        <button className="btn primary" disabled={busy || !title.trim()} onClick={submit}>
          Send ✉️
        </button>
      </div>
    </section>
  );
}

function WorkHistory({ agent }: { agent: Agent }) {
  const tasks = useTown((s) => s.snapshot!.tasks.filter((t) => t.agentId === agent.id && ["completed", "failed", "cancelled"].includes(t.status)));
  const [open, setOpen] = useState<string | null>(tasks[0]?.id ?? null);
  if (!tasks.length) return <Empty>No finished work yet.</Empty>;
  return (
    <div className="stack">
      {tasks.map((t) => (
        <TaskOutputCard key={t.id} task={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
      ))}
    </div>
  );
}

export function TaskOutputCard({ task, open, onToggle }: { task: Task; open: boolean; onToggle: () => void }) {
  const push = useTown((s) => s.pushToast);
  return (
    <section className="card">
      <button className="row between link full" onClick={onToggle}>
        <b>{task.title}</b>
        <span className="row gap-s">
          <ExecutionBadge task={task} />
          <Badge tone={TASK_TONE[task.status]}>{TASK_LABEL[task.status]}</Badge>
        </span>
      </button>
      <small className="muted">{task.completedAt ? `${clock(task.completedAt)} · ${timeAgo(task.completedAt)}` : ""}</small>
      {open && (
        <>
          <ExecutionProof task={task} />
          {task.output && <Markdown text={task.output} />}
          {task.lastError && <div className="error-box">{task.lastError}</div>}
          <div className="row gap-s">
            {task.output && (
              <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(task.output ?? "").then(() => push({ tone: "info", text: "Copied" }))}>
                Copy
              </button>
            )}
            {(task.status === "failed" || task.status === "cancelled") && (
              <button className="btn ghost" onClick={() => api.retryTask(task.id).catch((e) => push({ tone: "bad", text: String(e) }))}>
                ↻ Retry
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

const ACCESSORIES = ["crown", "goggles", "beret", "sprout", "none"];

function Config({ agent }: { agent: Agent }) {
  const status = useTown((s) => s.snapshot!.status);
  const buildings = useTown((s) => s.snapshot!.buildings);
  const push = useTown((s) => s.pushToast);
  const [form, setForm] = useState(() => ({
    name: agent.name,
    role: agent.role,
    personality: agent.personality,
    systemPrompt: agent.systemPrompt,
    responsibilities: agent.responsibilities.join("\n"),
    model: agent.model,
    effort: agent.effort,
    skills: agent.skills,
    buildingId: agent.buildingId,
    dailyBudget: agent.dailyBudgetUsd === null ? "" : String(agent.dailyBudgetUsd),
    color: agent.avatar.color,
    accessory: agent.avatar.accessory,
    enabled: agent.enabled,
  }));
  const [busy, setBusy] = useState(false);
  const models = useMemo(() => {
    const list = status.models.map((m) => m.id);
    return list.includes(agent.model) ? status.models : [...status.models, { id: agent.model, label: agent.model, inputPerMTok: 0, outputPerMTok: 0 }];
  }, [status.models, agent.model]);
  useEffect(() => setBusy(false), [agent.updatedAt]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await api.updateAgent(agent.id, {
        name: form.name,
        role: form.role,
        personality: form.personality,
        systemPrompt: form.systemPrompt,
        responsibilities: form.responsibilities.split("\n").map((s) => s.trim()).filter(Boolean),
        model: form.model,
        effort: form.effort,
        skills: form.skills,
        buildingId: form.buildingId,
        dailyBudgetUsd: form.dailyBudget.trim() ? Number(form.dailyBudget) : null,
        avatar: { color: form.color, accessory: form.accessory },
        enabled: form.enabled,
      });
      push({ tone: "good", text: `${form.name} updated` });
    } catch (err) {
      push({ tone: "bad", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack form">
      <div className="grid2">
        <label>
          Name
          <input value={form.name} maxLength={40} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label>
          Role
          <input value={form.role} maxLength={60} onChange={(e) => set("role", e.target.value)} />
        </label>
      </div>
      <label>
        Personality
        <textarea rows={2} value={form.personality} onChange={(e) => set("personality", e.target.value)} />
      </label>
      <label>
        System prompt
        <textarea rows={8} value={form.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} />
      </label>
      <label>
        Responsibilities <small className="muted">(one per line)</small>
        <textarea rows={3} value={form.responsibilities} onChange={(e) => set("responsibilities", e.target.value)} />
      </label>
      <div className="grid2">
        <label>
          Model
          <select value={form.model} onChange={(e) => set("model", e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.inputPerMTok ? ` — $${m.inputPerMTok}/$${m.outputPerMTok} per MTok` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Effort
          <select value={form.effort} onChange={(e) => set("effort", e.target.value as Effort)}>
            {["low", "medium", "high", "xhigh", "max"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
      </div>
      <SkillPicker value={form.skills} onChange={(v) => set("skills", v)} />
      <div className="grid2">
        <label>
          Works at
          <select value={form.buildingId} onChange={(e) => set("buildingId", e.target.value)}>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} — {b.department}
              </option>
            ))}
          </select>
        </label>
        <label>
          Personal daily cap (USD)
          <input type="number" min={0} step={0.5} placeholder="none — global limits apply" value={form.dailyBudget} onChange={(e) => set("dailyBudget", e.target.value)} />
        </label>
      </div>
      <div className="grid2">
        <label>
          Colour
          <input type="color" value={form.color} onChange={(e) => set("color", e.target.value)} />
        </label>
        <label>
          Accessory
          <select value={form.accessory} onChange={(e) => set("accessory", e.target.value)}>
            {[...new Set([...ACCESSORIES, form.accessory])].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        <span>Enabled (disabled villagers take no new tasks)</span>
      </label>
      <button className="btn primary full" disabled={busy} onClick={save}>
        Save changes
      </button>
    </div>
  );
}
