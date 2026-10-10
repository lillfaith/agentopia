import { useEffect, useMemo, useState } from "react";
import type { Agent, Effort, InstructionProfile, ProfileVersion } from "../../../shared/types";
import { profileOf, profileToMarkdown, sameProfile } from "../../../shared/profile";
import { DEMO, api } from "../api/client";
import { useTown } from "../state/store";
import { AiSetup, aiSetupFrom, aiSetupPayload, type AiSetupValue } from "./AiSetup";
import { timeAgo } from "./common";
import { ConnectionsStrip, EquipmentGrid, PermissionsList } from "./Equipment";
import { InstructionsEditor } from "./InstructionsEditor";

type Section = "job" | "instructions" | "equipment" | "connections" | "permissions" | "workplace";
const SECTIONS: [Section, string][] = [
  ["job", "🪪 Job"],
  ["instructions", "📋 Instructions"],
  ["equipment", "🧰 Equipment"],
  ["connections", "🧠 Model"],
  ["permissions", "🔐 Permissions"],
  ["workplace", "🏠 Workplace"],
];

interface Form {
  name: string;
  profile: InstructionProfile;
  skills: string[];
  approvalTools: string[];
  ai: AiSetupValue;
  effort: Effort;
  buildingId: string;
  dailyBudget: string;
  enabled: boolean;
}

function formOf(a: Agent): Form {
  return {
    name: a.name,
    profile: profileOf(a),
    skills: a.skills,
    approvalTools: a.approvalTools ?? [],
    ai: aiSetupFrom(a),
    effort: a.effort,
    buildingId: a.buildingId,
    dailyBudget: a.dailyBudgetUsd === null ? "" : String(a.dailyBudgetUsd),
    enabled: a.enabled,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Everything about an employee after hiring, in small sections. Unsaved edits are never thrown
 * away when the employee's status changes, and instruction edits carry the version they were
 * based on: if someone else changed the instructions meanwhile, the save is refused, not merged.
 */
export function EmployeeConfig({ agent }: { agent: Agent }) {
  const push = useTown((s) => s.pushToast);
  const buildings = useTown((s) => s.snapshot!.buildings);
  const [section, setSection] = useState<Section>("job");
  const [base, setBase] = useState<Agent>(agent);
  const [form, setForm] = useState<Form>(() => formOf(agent));
  const [busy, setBusy] = useState<string | null>(null);
  const baseForm = useMemo(() => formOf(base), [base]);
  const dirty = !same(form, baseForm);
  const profileDirty = !sameProfile(form.profile, baseForm.profile);
  const stale = (agent.profileVersion ?? 1) !== (base.profileVersion ?? 1);

  // Follow outside changes while there's nothing unsaved; otherwise keep the owner's edits.
  useEffect(() => {
    if (!dirty) {
      setBase(agent);
      setForm(formOf(agent));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.updatedAt]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy("save");
    try {
      const body: Parameters<typeof api.updateAgent>[1] = {};
      if (form.name !== baseForm.name) body.name = form.name;
      if (profileDirty) {
        Object.assign(body, form.profile);
        body.baseProfileVersion = base.profileVersion;
      }
      if (!same(form.skills, baseForm.skills)) body.skills = form.skills;
      if (!same(form.approvalTools, baseForm.approvalTools)) body.approvalTools = form.approvalTools;
      if (!same(form.ai, baseForm.ai)) Object.assign(body, aiSetupPayload(form.ai));
      if (form.effort !== baseForm.effort) body.effort = form.effort;
      if (form.buildingId !== baseForm.buildingId) body.buildingId = form.buildingId;
      if (form.dailyBudget !== baseForm.dailyBudget) body.dailyBudgetUsd = form.dailyBudget.trim() ? Number(form.dailyBudget) : null;
      if (form.enabled !== baseForm.enabled) body.enabled = form.enabled;
      const updated = await api.updateAgent(agent.id, body);
      setBase(updated);
      setForm(formOf(updated));
      push({ tone: "good", text: `${updated.name} updated${profileDirty ? ` · instructions v${updated.profileVersion}` : ""}` });
    } catch (err) {
      push({ tone: "bad", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const discard = () => {
    setBase(agent);
    setForm(formOf(agent));
  };

  return (
    <div className="stack form config">
      <div className="config-sections" role="tablist">
        {SECTIONS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} className={`pill ${section === id ? "on" : ""}`} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </div>

      {stale && dirty && (
        <div className="note-box small row between">
          <span>
            Their instructions were changed somewhere else (now v{agent.profileVersion}). Your unsaved edits are still here; saving instruction changes will be refused until you load the latest.
          </span>
          <button type="button" className="btn" onClick={discard}>
            Load latest
          </button>
        </div>
      )}

      {section === "job" && (
        <section className="stack">
          <div className="grid2">
            <label>
              Name
              <input value={form.name} maxLength={40} onChange={(e) => set("name", e.target.value)} />
            </label>
            <label>
              Job title
              <input value={form.profile.role} maxLength={60} onChange={(e) => set("profile", { ...form.profile, role: e.target.value })} />
            </label>
          </div>
          <label>
            Personality
            <input value={form.profile.personality} onChange={(e) => set("profile", { ...form.profile, personality: e.target.value })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
            <span>On duty (employees off duty take no new jobs)</span>
          </label>
          <TemplateActions agent={agent} />
        </section>
      )}

      {section === "instructions" && (
        <section className="stack">
          <InstructionsEditor value={form.profile} onChange={(p) => set("profile", p)} />
          <Redraft agent={agent} onApply={(p) => set("profile", p)} current={form.profile} />
          <VersionHistory agent={agent} base={base} dirty={profileDirty} onRestored={(a) => (setBase(a), setForm(formOf(a)))} />
        </section>
      )}

      {section === "equipment" && <EquipmentGrid value={form.skills} onChange={(v) => set("skills", v)} ctx={{ provider: form.ai.provider, githubCredentialId: form.ai.githubCredentialId }} />}

      {section === "connections" && (
        <section className="stack">
          <AiSetup value={form.ai} onChange={(v) => set("ai", v)} skills={form.skills} />
          <label>
            Effort
            <select value={form.effort} onChange={(e) => set("effort", e.target.value as Effort)}>
              {["low", "medium", "high", "xhigh", "max"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <ConnectionsStrip />
        </section>
      )}

      {section === "permissions" && (
        <section className="stack">
          <p className="muted small">Choose which of {agent.name}'s actions wait for you in Approvals. Anything that reaches people or the outside world always asks.</p>
          <PermissionsList skills={form.skills} value={form.approvalTools} onChange={(v) => set("approvalTools", v)} />
        </section>
      )}

      {section === "workplace" && (
        <section className="stack">
          <label>
            Works at
            <select value={form.buildingId} onChange={(e) => set("buildingId", e.target.value)}>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}: {b.department}
                </option>
              ))}
            </select>
          </label>
          <label>
            Daily spending cap (USD)
            <input type="number" min={0} step={0.5} placeholder="none (town limits apply)" value={form.dailyBudget} onChange={(e) => set("dailyBudget", e.target.value)} />
          </label>
        </section>
      )}

      <div className="config-save row between">
        <small className="muted">{dirty ? "Unsaved changes" : `Instructions v${base.profileVersion ?? 1}`}</small>
        <span className="row gap-s">
          {dirty && (
            <button type="button" className="btn ghost" onClick={discard}>
              Discard
            </button>
          )}
          <button type="button" className="btn primary" disabled={!dirty || busy === "save"} onClick={save}>
            {busy === "save" ? "Saving…" : "Save changes"}
          </button>
        </span>
      </div>
    </div>
  );
}

/** Ask for a fresh draft from a description; it fills the editor only when the owner says so. */
function Redraft({ agent, current, onApply }: { agent: Agent; current: InstructionProfile; onApply: (p: InstructionProfile) => void }) {
  const push = useTown((s) => s.pushToast);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<InstructionProfile | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const ask = async () => {
    setBusy(true);
    try {
      const d = await api.draftEmployee({ description: text.trim(), role: current.role, name: agent.name });
      setDraft({ ...current, role: d.role, personality: d.personality, systemPrompt: d.systemPrompt, responsibilities: d.responsibilities, operatingInstructions: d.operatingInstructions, taskInstructions: d.taskInstructions });
      setNote(d.note);
    } catch (e) {
      push({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="option">
      <summary>✨ Rewrite from a description</summary>
      <textarea rows={3} value={text} placeholder="Describe what you want them to do now, in plain words." onChange={(e) => setText(e.target.value)} />
      <button type="button" className="btn" disabled={busy || text.trim().length < 3 || DEMO} onClick={ask}>
        {busy ? "Writing…" : "Write a suggestion"}
      </button>
      {draft && (
        <div className="card">
          {note && <small className="muted">{note}</small>}
          <pre className="draft-preview">{profileToMarkdown(draft)}</pre>
          <small className="muted">Your current instructions stay as they are unless you use this suggestion. Nothing is saved until you press Save.</small>
          <div className="row gap-s">
            <button type="button" className="btn primary" onClick={() => (onApply(draft), setDraft(null))}>
              Use this suggestion
            </button>
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </details>
  );
}

const SOURCE_LABEL: Record<ProfileVersion["source"], string> = { hire: "Hired", edit: "Edited", restore: "Restored", draft: "Draft", migration: "Before versioning" };

function VersionHistory({ agent, base, dirty, onRestored }: { agent: Agent; base: Agent; dirty: boolean; onRestored: (a: Agent) => void }) {
  const push = useTown((s) => s.pushToast);
  const [versions, setVersions] = useState<ProfileVersion[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const load = () => (DEMO ? setVersions([]) : api.profileVersions(agent.id).then((r) => setVersions(r.versions), () => setVersions([])));
  const restore = async (v: number) => {
    try {
      const a = await api.restoreProfile(agent.id, v, base.profileVersion);
      onRestored(a);
      push({ tone: "good", text: `Restored version ${v} as v${a.profileVersion}` });
      load();
    } catch (e) {
      push({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <details className="option" onToggle={(e) => (e.target as HTMLDetailsElement).open && load()}>
      <summary>🕘 Version history</summary>
      {!versions && <small className="muted">Loading…</small>}
      {versions?.map((v) => (
        <div key={v.version} className="version-row">
          <div className="row between">
            <button type="button" className="link" onClick={() => setOpen(open === v.version ? null : v.version)}>
              <b>v{v.version}</b> · {SOURCE_LABEL[v.source]} · {timeAgo(v.createdAt)}
              {v.note ? ` · ${v.note}` : ""}
            </button>
            {v.version === base.profileVersion ? (
              <small className="muted">current</small>
            ) : (
              <button type="button" className="btn ghost" disabled={dirty} title={dirty ? "Save or discard your edits first" : ""} onClick={() => restore(v.version)}>
                Restore
              </button>
            )}
          </div>
          {open === v.version && <pre className="draft-preview">{profileToMarkdown(v.profile)}</pre>}
        </div>
      ))}
    </details>
  );
}

/** Save as a reusable template, or download the instructions / template file. */
function TemplateActions({ agent }: { agent: Agent }) {
  const push = useTown((s) => s.pushToast);
  const load = useTown((s) => s.load);
  const saveTemplate = async () => {
    try {
      const t = await api.saveAsTemplate(agent.id, {});
      await load();
      push({ tone: "good", text: `Saved “${t.role}” to your templates ⭐` });
    } catch (e) {
      push({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    }
  };
  const download = (name: string, text: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const slug = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <div className="row gap-s template-actions">
      <button type="button" className="btn" disabled={DEMO} onClick={saveTemplate}>
        ⭐ Save as template
      </button>
      <button type="button" className="btn ghost" onClick={() => download(`${slug}-AGENTS.md`, profileToMarkdown(profileOf(agent)), "text/markdown")}>
        ⬇ AGENTS.md
      </button>
    </div>
  );
}
