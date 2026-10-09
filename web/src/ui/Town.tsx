import { useMemo, useState } from "react";
import type { AgentTemplate, Building, Effort } from "../../../shared/types";
import { api } from "../api/client";
import { STATUS_LABEL, useTown } from "../state/store";
import { AiSetup, aiSetupFrom, aiSetupPayload } from "./AiSetup";
import { useTheme } from "../theme-engine/ThemeContext";
import { Badge, Drawer, Empty, SkillChip, StatusDot, fmtUsd } from "./common";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Tab = "villagers" | "hire" | "departments";

export function TownPanel() {
  const theme = useTheme();
  const close = useTown((s) => s.openPanel);
  const [tab, setTab] = useState<Tab>("villagers");
  return (
    <Drawer side="left" title="Town hall records" icon={theme.ui.icons.town} onClose={() => close(null)} wide>
      <div className="tabs">
        <button className={tab === "villagers" ? "on" : ""} onClick={() => setTab("villagers")}>
          Villagers
        </button>
        <button className={tab === "hire" ? "on" : ""} onClick={() => setTab("hire")}>
          ✨ Hire
        </button>
        <button className={tab === "departments" ? "on" : ""} onClick={() => setTab("departments")}>
          Departments
        </button>
      </div>
      {tab === "villagers" && <Villagers onHire={() => setTab("hire")} />}
      {tab === "hire" && <Hire onDone={() => setTab("villagers")} />}
      {tab === "departments" && <Departments />}
    </Drawer>
  );
}

function Villagers({ onHire }: { onHire: () => void }) {
  const snap = useTown((s) => s.snapshot)!;
  const select = useTown((s) => s.selectAgent);
  const push = useTown((s) => s.pushToast);
  const [showArchived, setShowArchived] = useState(false);
  const active = snap.agents.filter((a) => !a.archived);
  const archived = snap.agents.filter((a) => a.archived);
  const skills = new Map(snap.status.skills.map((s) => [s.id, s]));
  const buildings = new Map(snap.buildings.map((b) => [b.id, b]));
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      push({ tone: "good", text: ok });
    } catch (e) {
      push({ tone: "bad", text: errText(e) });
    }
  };
  return (
    <div className="stack">
      <div className="row between">
        <small className="muted">{active.length} villagers working in {snap.buildings.length} buildings</small>
        <button className="btn primary" onClick={onHire}>
          ✨ Hire a villager
        </button>
      </div>
      {active.map((a) => (
        <section key={a.id} className="card villager">
          <div className="row between">
            <button className="link row gap-s" onClick={() => select(a.id)}>
              <span className="avatar-dot big" style={{ background: a.appearance.bodyColor }} />
              <span>
                <b>{a.name}</b> <small className="muted">{a.role}</small>
                <br />
                <small>
                  <StatusDot status={a.status} /> {STATUS_LABEL[a.status]} · {buildings.get(a.buildingId)?.name ?? "no building"}
                  {a.dailyBudgetUsd !== null && ` · cap ${fmtUsd(a.dailyBudgetUsd)}/day`}
                </small>
              </span>
            </button>
            <span className="row gap-s">
              <button className="btn ghost" onClick={() => select(a.id)}>
                Edit
              </button>
              <button
                className="btn ghost danger"
                onClick={() => {
                  if (confirm(`Archive ${a.name}? Their history is kept, queued tasks are cancelled and their schedules paused.`)) void act(() => api.archiveAgent(a.id), `${a.name} left town`);
                }}
              >
                Archive
              </button>
            </span>
          </div>
          <div className="chips">
            {a.skills.map((id) => skills.get(id)).filter(Boolean).map((s) => <SkillChip key={s!.id} skill={s!} />)}
          </div>
        </section>
      ))}
      {archived.length > 0 && (
        <details open={showArchived} onToggle={(e) => setShowArchived((e.target as HTMLDetailsElement).open)}>
          <summary>Archived villagers ({archived.length})</summary>
          <ul className="task-mini">
            {archived.map((a) => (
              <li key={a.id}>
                <span>
                  {a.name} <small className="muted">{a.role}</small>
                </span>
                <button className="btn ghost" onClick={() => void act(() => api.restoreAgent(a.id), `${a.name} moved back`)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const ACCESSORIES = ["crown", "goggles", "beret", "sprout", "none"];

function Hire({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const snap = useTown((s) => s.snapshot)!;
  const push = useTown((s) => s.pushToast);
  const [template, setTemplate] = useState<AgentTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    role: "",
    personality: "",
    systemPrompt: "",
    responsibilities: "",
    skills: ["writing"] as string[],
    color: "#ffc9d9",
    accessory: "sprout",
    ai: aiSetupFrom({
      provider: "anthropic",
      credentialId: null,
      model: snap.status.models.find((m) => !snap.status.allowedModels || snap.status.allowedModels.includes(m.id))?.id ?? snap.status.models[0]?.id ?? "claude-opus-5-5",
      githubCredentialId: null,
      customPrices: null,
    }),
    effort: "medium" as Effort,
    buildingId: snap.buildings[0]?.id ?? "",
    dailyBudget: "",
    newDepartment: false,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const freeSlots = Object.keys(theme.world.slots).filter((slot) => !snap.buildings.some((b) => b.slot === slot));

  const pick = (t: AgentTemplate) => {
    setTemplate(t);
    const matching = snap.buildings.find((b) => b.kind === t.buildingKind);
    setForm((f) => ({
      ...f,
      role: t.role,
      personality: t.personality,
      systemPrompt: t.systemPrompt,
      responsibilities: t.responsibilities.join("\n"),
      skills: t.skills,
      color: t.avatar.color,
      accessory: t.avatar.accessory,
      effort: t.effort,
      buildingId: matching?.id ?? f.buildingId,
      newDepartment: !matching && freeSlots.length > 0,
    }));
  };

  const submit = async () => {
    setBusy(true);
    try {
      let buildingId = form.buildingId;
      if (form.newDepartment) {
        if (!freeSlots.length) throw new Error("No free plots left — reuse an existing building");
        const style = theme.world.buildingStyles.find((s) => s.kind === template?.buildingKind) ?? theme.world.buildingStyles[0];
        const department = template?.department ?? `${form.role} Dept.`;
        const b = await api.createBuilding({ name: `${department} ${style.label}`.slice(0, 40), department, kind: style.kind, slot: freeSlots[0], description: `Home of the ${department} department.` });
        buildingId = b.id;
      }
      const agent = await api.hireAgent({
        name: form.name.trim(),
        role: form.role.trim(),
        personality: form.personality,
        systemPrompt: form.systemPrompt.trim(),
        responsibilities: form.responsibilities.split("\n").map((s) => s.trim()).filter(Boolean),
        skills: form.skills,
        avatar: { color: form.color, accessory: form.accessory },
        buildingId,
        ...aiSetupPayload(form.ai),
        effort: form.effort,
        dailyBudgetUsd: form.dailyBudget.trim() ? Number(form.dailyBudget) : null,
      });
      push({ tone: "good", text: `${agent.name} the ${agent.role} moved into town 🏡` });
      useTown.getState().selectAgent(agent.id);
      onDone();
    } catch (e) {
      push({ tone: "bad", text: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack form">
      <h3>1 · Pick a starting point</h3>
      <div className="template-grid">
        {snap.templates.map((t) => (
          <button key={t.id} className={`template ${template?.id === t.id ? "on" : ""}`} onClick={() => pick(t)} title={t.description}>
            <span className="template-icon">{t.icon}</span>
            <b>{t.role}</b>
            <small>{t.description}</small>
          </button>
        ))}
      </div>
      <h3>2 · Make them yours</h3>
      <div className="grid2">
        <label>
          Name *
          <input value={form.name} maxLength={40} placeholder="e.g. Bolt" onChange={(e) => set("name", e.target.value)} />
        </label>
        <label>
          Role *
          <input value={form.role} maxLength={60} placeholder="e.g. Engineer" onChange={(e) => set("role", e.target.value)} />
        </label>
      </div>
      <label>
        System prompt *
        <textarea rows={5} value={form.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} placeholder="Who they are and how they work…" />
      </label>
      <label>
        Personality
        <input value={form.personality} onChange={(e) => set("personality", e.target.value)} />
      </label>
      <label>
        Responsibilities <small className="muted">(one per line)</small>
        <textarea rows={2} value={form.responsibilities} onChange={(e) => set("responsibilities", e.target.value)} />
      </label>
      <SkillPicker value={form.skills} onChange={(v) => set("skills", v)} />
      <AiSetup value={form.ai} onChange={(v) => set("ai", v)} skills={form.skills} />
      <div className="grid2">
        <label>
          Effort
          <select value={form.effort} onChange={(e) => set("effort", e.target.value as Effort)}>
            {["low", "medium", "high", "xhigh", "max"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Daily spend cap (USD, optional)
          <input type="number" min={0} step={0.5} value={form.dailyBudget} placeholder="no personal cap" onChange={(e) => set("dailyBudget", e.target.value)} />
        </label>
        <label>
          Look
          <span className="row gap-s">
            <input type="color" value={form.color} onChange={(e) => set("color", e.target.value)} style={{ width: 56 }} />
            <select value={form.accessory} onChange={(e) => set("accessory", e.target.value)}>
              {ACCESSORIES.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </span>
        </label>
      </div>
      <h3>3 · Where do they work?</h3>
      <label className="check">
        <input type="checkbox" checked={form.newDepartment} disabled={!freeSlots.length} onChange={(e) => set("newDepartment", e.target.checked)} />
        <span>
          Build a new {template?.department ?? "department"} building {freeSlots.length ? `on the ${theme.world.slotLabels[freeSlots[0]] ?? freeSlots[0]}` : "(no free plots)"}
        </span>
      </label>
      {!form.newDepartment && (
        <label>
          Building
          <select value={form.buildingId} onChange={(e) => set("buildingId", e.target.value)}>
            {snap.buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} — {b.department}
              </option>
            ))}
          </select>
        </label>
      )}
      <button className="btn primary full" disabled={busy || !form.name.trim() || !form.role.trim() || !form.systemPrompt.trim()} onClick={submit}>
        🏡 Welcome to town
      </button>
    </div>
  );
}

export function SkillPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const skills = useTown((s) => s.snapshot!.status.skills);
  const verifications = useTown((s) => s.snapshot!.status.verifications);
  return (
    <fieldset>
      <legend>Skills</legend>
      {skills.map((s) => {
        const v = s.verificationCheck ? verifications.find((x) => x.checkId === s.verificationCheck) : null;
        return (
          <label key={s.id} className="check">
            <input type="checkbox" checked={value.includes(s.id)} onChange={(e) => onChange(e.target.checked ? [...value, s.id] : value.filter((x) => x !== s.id))} />
            <span>
              <b>
                {s.icon} {s.label}
              </b>{" "}
              {s.status === "planned" && <Badge tone="muted">planned · inactive</Badge>}
              {s.tools.some((t) => t.requiresApproval) && <Badge tone="warn">needs approval</Badge>}
              {s.tools.some((t) => t.implementation === "placeholder") && <Badge tone="muted">placeholder</Badge>}
              {v && <Badge tone={v.ok ? "good" : "bad"}>{v.ok ? "verified live" : "last check failed"}</Badge>}
              {s.status === "available" && s.verificationCheck && !v && <Badge tone="muted">not yet verified live</Badge>}
              <br />
              <small className="muted">{s.description}</small>
              <br />
              <small className="muted">💰 {s.costNote}</small>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function Departments() {
  const theme = useTheme();
  const snap = useTown((s) => s.snapshot)!;
  const push = useTown((s) => s.pushToast);
  const freeSlots = Object.keys(theme.world.slots).filter((slot) => !snap.buildings.some((b) => b.slot === slot));
  const [form, setForm] = useState({ name: "", department: "", kind: theme.world.buildingStyles[0]?.kind ?? "studio", slot: freeSlots[0] ?? "", description: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const residents = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of snap.agents.filter((x) => !x.archived)) m.set(a.buildingId, [...(m.get(a.buildingId) ?? []), a.name]);
    return m;
  }, [snap.agents]);
  const styleOf = (kind: string) => theme.world.buildingStyles.find((s) => s.kind === kind);

  const create = async () => {
    try {
      const b = await api.createBuilding({ ...form, slot: form.slot || freeSlots[0] });
      push({ tone: "good", text: `${b.name} was built 🏗️` });
      setForm({ ...form, name: "", department: "", description: "", slot: freeSlots.filter((s) => s !== b.slot)[0] ?? "" });
      useTown.getState().selectBuilding(b.id);
    } catch (e) {
      push({ tone: "bad", text: errText(e) });
    }
  };

  return (
    <div className="stack">
      {snap.buildings.map((b) =>
        editing === b.id ? (
          <BuildingEditor key={b.id} building={b} onDone={() => setEditing(null)} />
        ) : (
          <section key={b.id} className="card">
            <div className="row between">
              <span>
                <b>
                  {styleOf(b.kind)?.icon ?? "🏠"} {b.name}
                </b>{" "}
                <small className="muted">
                  {b.department} · {styleOf(b.kind)?.label ?? b.kind} · {theme.world.slotLabels[b.slot] ?? b.slot}
                </small>
              </span>
              <span className="row gap-s">
                <button className="btn ghost" onClick={() => useTown.getState().selectBuilding(b.id)}>
                  View
                </button>
                <button className="btn ghost" onClick={() => setEditing(b.id)}>
                  Edit
                </button>
                <button
                  className="btn ghost danger"
                  disabled={!!residents.get(b.id)?.length}
                  title={residents.get(b.id)?.length ? "Move its villagers first" : "Demolish"}
                  onClick={async () => {
                    if (!confirm(`Demolish ${b.name}?`)) return;
                    try {
                      await api.deleteBuilding(b.id);
                    } catch (e) {
                      push({ tone: "bad", text: errText(e) });
                    }
                  }}
                >
                  Demolish
                </button>
              </span>
            </div>
            <small>{residents.get(b.id)?.length ? `👥 ${residents.get(b.id)!.join(", ")}` : <span className="muted">Empty — assign villagers in their Configure tab</span>}</small>
          </section>
        ),
      )}
      <section className="card composer form">
        <h3>🏗️ Build a new department</h3>
        {!freeSlots.length ? (
          <Empty>Every plot in this theme is taken.</Empty>
        ) : (
          <>
            <div className="grid2">
              <label>
                Building name *
                <input value={form.name} maxLength={40} placeholder="e.g. Gearworks" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                Department *
                <input value={form.department} maxLength={60} placeholder="e.g. Engineering" onChange={(e) => setForm({ ...form, department: e.target.value })} />
              </label>
              <label>
                Style
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  {theme.world.buildingStyles.map((s) => (
                    <option key={s.kind} value={s.kind}>
                      {s.icon} {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Plot
                <select value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value })}>
                  {freeSlots.map((s) => (
                    <option key={s} value={s}>
                      {theme.world.slotLabels[s] ?? s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <small className="muted">{styleOf(form.kind)?.description}</small>
            <label>
              Description
              <input value={form.description} maxLength={500} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <button className="btn primary" disabled={!form.name.trim() || !form.department.trim()} onClick={create}>
              Build it
            </button>
          </>
        )}
      </section>
    </div>
  );
}

function BuildingEditor({ building, onDone }: { building: Building; onDone: () => void }) {
  const theme = useTheme();
  const snap = useTown((s) => s.snapshot)!;
  const push = useTown((s) => s.pushToast);
  const [f, setF] = useState({ name: building.name, department: building.department, kind: building.kind, slot: building.slot, description: building.description });
  const slots = Object.keys(theme.world.slots).filter((s) => s === building.slot || !snap.buildings.some((b) => b.slot === s));
  if (!slots.includes(building.slot)) slots.unshift(building.slot);
  const save = async () => {
    try {
      await api.updateBuilding(building.id, f);
      onDone();
    } catch (e) {
      push({ tone: "bad", text: errText(e) });
    }
  };
  return (
    <section className="card form">
      <div className="grid2">
        <label>
          Name
          <input value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label>
          Department
          <input value={f.department} maxLength={60} onChange={(e) => setF({ ...f, department: e.target.value })} />
        </label>
        <label>
          Style
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {theme.world.buildingStyles.map((s) => (
              <option key={s.kind} value={s.kind}>
                {s.icon} {s.label}
              </option>
            ))}
            {!theme.world.buildingStyles.some((s) => s.kind === f.kind) && <option value={f.kind}>{f.kind}</option>}
          </select>
        </label>
        <label>
          Plot
          <select value={f.slot} onChange={(e) => setF({ ...f, slot: e.target.value })}>
            {slots.map((s) => (
              <option key={s} value={s}>
                {theme.world.slotLabels[s] ?? s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Description
        <input value={f.description} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </label>
      <div className="row gap-s">
        <button className="btn primary" onClick={save}>
          Save
        </button>
        <button className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </section>
  );
}
