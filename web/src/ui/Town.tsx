import { useMemo, useState } from "react";
import type { Building } from "../../../shared/types";
import { api } from "../api/client";
import { STATUS_LABEL, useTown } from "../state/store";
import { HireWizard } from "./HireWizard";
import { useTheme } from "../theme-engine/ThemeContext";
import { Drawer, Empty, SkillChip, StatusDot, fmtUsd } from "./common";

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
          Employees
        </button>
        <button className={tab === "hire" ? "on" : ""} onClick={() => setTab("hire")}>
          ✨ Hire
        </button>
        <button className={tab === "departments" ? "on" : ""} onClick={() => setTab("departments")}>
          Workplaces
        </button>
      </div>
      {tab === "villagers" && <Villagers onHire={() => setTab("hire")} />}
      {tab === "hire" && <HireWizard onDone={() => setTab("villagers")} />}
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
        <small className="muted">{active.length} employees working in {snap.buildings.length} workplaces</small>
        <button className="btn primary" onClick={onHire}>
          ✨ Hire an employee
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
          <summary>Former employees ({archived.length})</summary>
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
