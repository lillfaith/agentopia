import { useMemo, useRef, useState } from "react";
import type { AgentTemplate, EmployeeDraft, Effort, InstructionProfile } from "../../../shared/types";
import { fmtUsd } from "./common";
import { profileProblems } from "../../../shared/profile";
import { api } from "../api/client";
import { useTown } from "../state/store";
import { useTheme } from "../theme-engine/ThemeContext";
import { AiSetup, aiSetupFrom, aiSetupPayload, type AiSetupValue } from "./AiSetup";
import { ConnectionsStrip, EquipmentGrid, PermissionsList } from "./Equipment";
import { InstructionsEditor } from "./InstructionsEditor";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const NAMES = ["Pippa", "Biscuit", "Clover", "Juniper", "Mochi", "Hazel", "Pebble", "Wren", "Tansy", "Nutmeg", "Basil", "Poppy", "Sprout", "Maple", "Figgy", "Bramble", "Plum", "Tofu", "Marigold", "Sunny"];
const ACCESSORIES = ["sprout", "crown", "goggles", "beret", "none"];
const BLANK: AgentTemplate = {
  id: "",
  role: "",
  icon: "✨",
  description: "Start from scratch and describe any job you like.",
  personality: "",
  systemPrompt: "",
  responsibilities: [],
  skills: ["writing", "memory"],
  effort: "medium",
  avatar: { color: "#ffc9d9", accessory: "sprout" },
  buildingKind: "studio",
  department: "",
};

type Step = 1 | 2 | 3;
interface HireState {
  template: AgentTemplate | null; // null = custom
  name: string;
  description: string;
  profile: InstructionProfile;
  /** True once the owner edits the instructions by hand: drafts then become suggestions, never replacements. */
  edited: boolean;
  draft: EmployeeDraft | null;
  /** What the last draft was made from (description + source), so the same request isn't sent twice. */
  draftedFrom: string;
  /** How to write the instructions: "template" (free, default), "platform" (Agentopia's Claude) or an owner key id. */
  draftSource: DraftSource;
  skills: string[];
  approvalTools: string[];
  effort: Effort;
  color: string;
  accessory: string;
  workplace: string; // "auto" | "new" | building id
  ai: AiSetupValue;
  dailyBudget: string;
  saveTemplate: boolean;
}

function profileFrom(t: AgentTemplate): InstructionProfile {
  return {
    role: t.role,
    personality: t.personality,
    systemPrompt: t.systemPrompt,
    responsibilities: t.responsibilities,
    operatingInstructions: t.operatingInstructions ?? "",
    taskInstructions: t.taskInstructions ?? "",
    referenceNotes: t.referenceNotes ?? "",
  };
}

/**
 * Hire an employee in three steps: ① choose a job, ② name it and say what it should do,
 * ③ review and welcome it to town. Everything technical (look, workplace, model, costs,
 * permissions) is optional and folded away; all of it stays editable after hiring.
 */
export function HireWizard({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const snap = useTown((s) => s.snapshot)!;
  const push = useTown((s) => s.pushToast);
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState<string | null>(null);
  const defaultModel = snap.status.models.find((m) => !snap.status.allowedModels || snap.status.allowedModels.includes(m.id))?.id ?? snap.status.models[0]?.id ?? "claude-opus-5-5";
  const [s, setS] = useState<HireState>(() => ({
    template: null,
    name: "",
    description: "",
    profile: profileFrom(BLANK),
    edited: false,
    draft: null,
    draftedFrom: "",
    draftSource: "template",
    skills: BLANK.skills,
    approvalTools: [],
    effort: "medium",
    color: BLANK.avatar.color,
    accessory: BLANK.avatar.accessory,
    workplace: "auto",
    ai: aiSetupFrom({ provider: "anthropic", credentialId: null, model: defaultModel, githubCredentialId: null, customPrices: null }),
    dailyBudget: "",
    saveTemplate: false,
  }));
  const set = <K extends keyof HireState>(k: K, v: HireState[K]) => setS((x) => ({ ...x, [k]: v }));
  const freeSlots = Object.keys(theme.world.slots).filter((slot) => !snap.buildings.some((b) => b.slot === slot));
  const t = s.template ?? BLANK;
  const matching = snap.buildings.find((b) => b.kind === t.buildingKind);
  const workplaceLabel =
    s.workplace === "auto"
      ? matching
        ? matching.name
        : freeSlots.length
          ? `A new ${t.department || s.profile.role || "team"} building`
          : (snap.buildings[0]?.name ?? "Town Hall")
      : s.workplace === "new"
        ? `A new ${t.department || s.profile.role || "team"} building`
        : (snap.buildings.find((b) => b.id === s.workplace)?.name ?? "");

  const choose = (tpl: AgentTemplate | null) => {
    const base = tpl ?? BLANK;
    setS((x) => ({
      ...x,
      template: tpl,
      profile: profileFrom(base),
      edited: false,
      draft: null,
      draftedFrom: "",
      skills: base.skills,
      approvalTools: [],
      effort: base.effort,
      color: base.avatar.color,
      accessory: base.avatar.accessory,
      workplace: "auto",
    }));
    setStep(2);
  };

  /**
   * Make the draft the owner chose. The free template draft is the default; an AI draft is only
   * requested when they picked an AI source, and never twice for the same description and source.
   */
  const draftAndReview = async () => {
    const description = s.description.trim();
    const source = description ? s.draftSource : "template";
    const requestKey = `${source}|${s.profile.role.trim()}|${description}`;
    if (!description || requestKey === s.draftedFrom) return setStep(3);
    setBusy("draft");
    try {
      const d = await api.draftEmployee({
        description,
        role: s.profile.role.trim() || undefined,
        templateId: s.template?.id || undefined,
        mode: source === "template" ? "template" : "ai",
        credentialId: source === "template" || source === "platform" ? null : source,
      });
      setS((x) =>
        x.edited
          ? { ...x, draft: d, draftedFrom: requestKey }
          : {
              ...x,
              draft: d,
              draftedFrom: requestKey,
              profile: { ...x.profile, role: d.role, personality: d.personality, systemPrompt: d.systemPrompt, responsibilities: d.responsibilities, operatingInstructions: d.operatingInstructions, taskInstructions: d.taskInstructions },
              skills: d.skills,
            },
      );
      setStep(3);
    } catch (e) {
      // Still let them hire: the template's instructions are a fine start and stay editable.
      push({ tone: "warn", text: `Couldn't draft instructions (${errText(e)}). Using the template; you can edit it.` });
      setStep(3);
    } finally {
      setBusy(null);
    }
  };

  const applyDraft = () =>
    s.draft &&
    setS((x) => ({
      ...x,
      profile: { ...x.profile, role: x.draft!.role, personality: x.draft!.personality, systemPrompt: x.draft!.systemPrompt, responsibilities: x.draft!.responsibilities, operatingInstructions: x.draft!.operatingInstructions, taskInstructions: x.draft!.taskInstructions },
      skills: x.draft!.skills,
      edited: false,
    }));

  const problems = profileProblems(s.profile);
  const canHire = !!s.name.trim() && problems.length === 0;

  const hire = async () => {
    setBusy("hire");
    try {
      let buildingId = s.workplace !== "auto" && s.workplace !== "new" ? s.workplace : (matching?.id ?? "");
      if (s.workplace === "new" || (s.workplace === "auto" && !matching && freeSlots.length)) {
        if (!freeSlots.length) throw new Error("No free plots left. Pick an existing workplace.");
        const style = theme.world.buildingStyles.find((x) => x.kind === t.buildingKind) ?? theme.world.buildingStyles[0];
        const department = (t.department || `${s.profile.role} Team`).slice(0, 60);
        const b = await api.createBuilding({ name: `${department} ${style.label}`.slice(0, 40), department, kind: style.kind, slot: freeSlots[0], description: `Home of the ${department} team.` });
        buildingId = b.id;
      }
      if (!buildingId) buildingId = snap.buildings[0]?.id ?? "";
      const agent = await api.hireAgent({
        name: s.name.trim(),
        role: s.profile.role.trim(),
        personality: s.profile.personality,
        systemPrompt: s.profile.systemPrompt.trim(),
        responsibilities: s.profile.responsibilities.map((r) => r.trim()).filter(Boolean),
        operatingInstructions: s.profile.operatingInstructions,
        taskInstructions: s.profile.taskInstructions,
        referenceNotes: s.profile.referenceNotes,
        skills: s.skills,
        approvalTools: s.approvalTools,
        templateId: s.template?.id || null,
        avatar: { color: s.color, accessory: s.accessory },
        buildingId,
        ...aiSetupPayload(s.ai),
        effort: s.effort,
        dailyBudgetUsd: s.dailyBudget.trim() ? Number(s.dailyBudget) : null,
      });
      if (s.saveTemplate) await api.saveAsTemplate(agent.id, { icon: t.icon }).catch(() => undefined);
      push({ tone: "good", text: `${agent.name} the ${agent.role} moved into town 🏡` });
      useTown.getState().selectAgent(agent.id);
      onDone();
    } catch (e) {
      push({ tone: "bad", text: errText(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack form hire">
      <ol className="hire-steps" aria-label="Hiring steps">
        {(["Choose a job", "Name & job", "Review"] as const).map((label, i) => (
          <li key={label} className={step === i + 1 ? "on" : step > i + 1 ? "done" : ""}>
            <button type="button" disabled={i + 1 > step} onClick={() => setStep((i + 1) as Step)}>
              <span className="hire-step-num">{step > i + 1 ? "✓" : i + 1}</span> {label}
            </button>
          </li>
        ))}
      </ol>

      {step === 1 && <ChooseJob onChoose={choose} />}

      {step === 2 && (
        <section className="stack">
          <div className="hire-hero">
            <span className="hire-hero-icon" style={{ background: s.color }}>
              {t.icon}
            </span>
            <div>
              <b>{s.template ? `Hiring a ${s.template.role}` : "A custom employee"}</b>
              <small className="muted">{s.template?.description ?? "Describe any job and Agentopia will set them up."}</small>
            </div>
          </div>
          <label>
            Name
            <span className="row gap-s">
              <input value={s.name} maxLength={40} autoFocus placeholder="e.g. Clover" onChange={(e) => set("name", e.target.value)} />
              <button type="button" className="btn" title="Suggest a name" onClick={() => set("name", NAMES[Math.floor(Math.random() * NAMES.length)])}>
                🎲
              </button>
            </span>
          </label>
          <label>
            Job title
            <input
              value={s.profile.role}
              maxLength={60}
              placeholder="e.g. YouTube Manager, Store Manager, Stock Researcher"
              onChange={(e) => setS((x) => ({ ...x, profile: { ...x.profile, role: e.target.value } }))}
            />
          </label>
          <label>
            What should they do? <small className="muted">plain words are perfect</small>
            <textarea
              rows={4}
              value={s.description}
              maxLength={4000}
              placeholder={s.template ? `e.g. ${exampleFor(s.template.role)}` : "e.g. Keep my online candle shop tidy: write product listings, check competitor prices and draft replies to customers."}
              onChange={(e) => set("description", e.target.value)}
            />
            <small className="muted">
              {s.description.trim() ? "You can edit everything on the next step before hiring." : s.template ? "Optional. Leave it empty to use the template as it is." : "Tell us the job, or skip and write the instructions yourself on the next step."}
            </small>
          </label>
          {s.description.trim() && <DraftSourcePicker value={s.draftSource} onChange={(v) => set("draftSource", v)} />}
          <div className="row between">
            <button type="button" className="btn ghost" onClick={() => setStep(1)}>
              ← Back
            </button>
            <button type="button" className="btn primary" disabled={!s.name.trim() || !s.profile.role.trim() || busy === "draft"} onClick={draftAndReview}>
              {busy === "draft" ? "✨ Writing their instructions…" : s.description.trim() && s.draftSource !== "template" ? "✨ Write with AI & review" : "Next: review"}
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="stack">
          <div className="employee-card">
            <span className="employee-avatar" style={{ background: s.color }}>
              {t.icon}
            </span>
            <div className="employee-id">
              <b className="employee-name">{s.name || "New employee"}</b>
              <span className="employee-role">{s.profile.role}</span>
              {s.profile.personality && <small className="muted">{s.profile.personality}</small>}
            </div>
          </div>

          {s.draft && <DraftReceipt draft={s.draft} />}
          {s.draft?.note && <div className="note-box small">{s.draft.note}</div>}
          {s.draft && s.edited && (
            <div className="note-box small row between">
              <span>A new draft is ready. You've edited the instructions, so it wasn't applied.</span>
              <button type="button" className="btn" onClick={applyDraft}>
                Use the draft
              </button>
            </div>
          )}

          <section className="card">
            <h3>📋 Job & responsibilities</h3>
            <p className="small clamp3">{s.profile.systemPrompt || <span className="muted">No role description yet. Open the instructions below to write one.</span>}</p>
            {s.profile.responsibilities.length > 0 && (
              <ul className="resp-list small">
                {s.profile.responsibilities.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
            <details className="mini" open={problems.length > 0 && !s.profile.systemPrompt.trim()}>
              <summary>✏️ Edit instructions</summary>
              <InstructionsEditor
                compact
                value={s.profile}
                onChange={(p) => setS((x) => ({ ...x, profile: p, edited: true }))}
              />
            </details>
          </section>

          <section className="card">
            <h3>🧰 Equipment</h3>
            <EquipmentGrid value={s.skills} onChange={(v) => set("skills", v)} ctx={{ provider: s.ai.provider, githubCredentialId: s.ai.githubCredentialId }} />
          </section>

          <div className="hire-summary small">
            <span>🏠 Works at <b>{workplaceLabel}</b></span>
            <span>🧠 Thinks with <b>{s.ai.credentialId ? `your ${s.ai.provider === "anthropic" ? "Claude" : s.ai.provider === "openai" ? "OpenAI" : "Gemini"} key` : "Agentopia's Claude"}</b> · {s.ai.model}</span>
          </div>

          <details className="option">
            <summary>🎨 Appearance</summary>
            <div className="row gap-s">
              <input type="color" value={s.color} onChange={(e) => set("color", e.target.value)} style={{ width: 56 }} aria-label="Colour" />
              <select value={s.accessory} onChange={(e) => set("accessory", e.target.value)} aria-label="Accessory">
                {ACCESSORIES.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </div>
            <small className="muted">Full wardrobe (eyes, ears, tails, outfits and voice) opens from their profile after hiring.</small>
          </details>
          <details className="option">
            <summary>🏠 Workplace</summary>
            <select value={s.workplace} onChange={(e) => set("workplace", e.target.value)}>
              <option value="auto">Choose for me ({workplaceLabel})</option>
              {freeSlots.length > 0 && <option value="new">Build a new {t.department || "team"} building</option>}
              {snap.buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}: {b.department}
                </option>
              ))}
            </select>
          </details>
          <details className="option">
            <summary>🧠 Model, connections & costs</summary>
            <AiSetup value={s.ai} onChange={(v) => set("ai", v)} skills={s.skills} />
            <ConnectionsStrip />
            <div className="grid2">
              <label>
                Effort
                <select value={s.effort} onChange={(e) => set("effort", e.target.value as Effort)}>
                  {["low", "medium", "high", "xhigh", "max"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                Daily spending cap (USD)
                <input type="number" min={0} step={0.5} value={s.dailyBudget} placeholder="no personal cap" onChange={(e) => set("dailyBudget", e.target.value)} />
              </label>
            </div>
          </details>
          <details className="option">
            <summary>🔐 Permissions</summary>
            <PermissionsList skills={s.skills} value={s.approvalTools} onChange={(v) => set("approvalTools", v)} />
          </details>

          <label className="check">
            <input type="checkbox" checked={s.saveTemplate} onChange={(e) => set("saveTemplate", e.target.checked)} />
            <span>⭐ Also save this job as a template</span>
          </label>
          <div className="row between">
            <button type="button" className="btn ghost" onClick={() => setStep(2)}>
              ← Back
            </button>
            <button type="button" className="btn primary welcome" disabled={!canHire || busy === "hire"} onClick={hire}>
              {busy === "hire" ? "Moving in…" : "🏡 Welcome to town"}
            </button>
          </div>
          {!s.name.trim() && <small className="muted">Give them a name on step 2.</small>}
        </section>
      )}
    </div>
  );
}

function exampleFor(role: string): string {
  const examples: Record<string, string> = {
    "General Assistant": "Help me answer emails, summarise articles and plan my week.",
    Researcher: "Find the best-selling oat-milk brands in the UK and compare prices.",
    Writer: "Write two blog posts a week about cosy home cooking, friendly and short.",
    Creator: "Come up with TikTok video ideas and scripts for my bakery.",
    Developer: "Write small Python scripts to clean up my CSV exports.",
    Marketer: "Plan an Instagram launch for my candle shop and write the posts.",
    Analyst: "Track competitor prices every week and tell me what changed.",
    Manager: "Turn my goals into briefs and hand the work to the team.",
  };
  return examples[role] ?? `Describe what your ${role} should do day to day.`;
}

/** Step 1: the eight broad jobs, a custom employee, saved templates and a searchable library. */
function ChooseJob({ onChoose }: { onChoose: (t: AgentTemplate | null) => void }) {
  const templates = useTown((s) => s.snapshot!.templates);
  const push = useTown((s) => s.pushToast);
  const load = useTown((s) => s.load);
  const [q, setQ] = useState("");
  const file = useRef<HTMLInputElement>(null);
  // Older demo data has no groups: treat everything as featured.
  const featured = templates.filter((t) => (t.group ?? "featured") === "featured");
  const custom = templates.filter((t) => t.group === "custom");
  const library = templates.filter((t) => t.group === "library");
  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return [...library, ...custom].filter((t) => {
      const hay = [t.role, t.description, t.tagline ?? "", t.department, ...(t.tags ?? [])].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [q, library, custom]);

  const importFile = async (f: File) => {
    try {
      const parsed = JSON.parse(await f.text());
      const { template, dropped } = await api.importTemplate(parsed);
      await load();
      push({ tone: "good", text: `Imported “${template.role}”${dropped.length ? ` (skipped unknown equipment: ${dropped.join(", ")})` : ""}` });
    } catch (e) {
      push({ tone: "bad", text: `Couldn't import: ${errText(e)}` });
    }
  };

  return (
    <section className="stack">
      <h3 className="hire-title">Who would you like to hire?</h3>
      <div className="job-grid">
        {featured.map((t) => (
          <JobCard key={t.id} t={t} onClick={() => onChoose(t)} />
        ))}
        <button type="button" className="job-card custom" onClick={() => onChoose(null)}>
          <span className="job-icon">✨</span>
          <b>Custom employee</b>
          <small>Any job you can describe</small>
        </button>
      </div>
      {custom.length > 0 && (
        <>
          <h4 className="muted">Your templates</h4>
          <div className="job-grid">
            {custom.map((t) => (
              <JobCard key={t.id} t={t} onClick={() => onChoose(t)} />
            ))}
          </div>
        </>
      )}
      <details className="option" open={!!q}>
        <summary>🔎 More jobs ({library.length})</summary>
        <input value={q} placeholder="Search: YouTube, store, stocks, email, 3D…" onChange={(e) => setQ(e.target.value)} />
        <div className="job-list">
          {(q ? results : library).map((t) => (
            <button key={t.id} type="button" className="job-row" onClick={() => onChoose(t)}>
              <span className="job-icon small">{t.icon}</span>
              <span>
                <b>{t.role}</b>
                <small className="muted">{t.tagline ?? t.description}</small>
              </span>
            </button>
          ))}
          {q && !results.length && <small className="muted">No match. Try “Custom employee” and describe the job.</small>}
        </div>
        <div className="row gap-s">
          <button type="button" className="btn ghost" onClick={() => file.current?.click()}>
            📥 Import a template file
          </button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        </div>
      </details>
    </section>
  );
}

function JobCard({ t, onClick }: { t: AgentTemplate; onClick: () => void }) {
  return (
    <button type="button" className="job-card" onClick={onClick} title={t.description}>
      <span className="job-icon" style={{ background: t.avatar.color }}>
        {t.icon}
      </span>
      <b>{t.role}</b>
      <small>{t.tagline ?? t.description}</small>
    </button>
  );
}

/** "template" = free; "platform" = Agentopia's Claude; anything else = an owner key id. */
export type DraftSource = "template" | "platform" | string;

/**
 * How to write the instructions. The free template draft is the default; AI is opt-in, with the
 * cost and who pays shown before anything runs.
 */
export function DraftSourcePicker({ value, onChange, allowTemplate = true }: { value: DraftSource; onChange: (v: DraftSource) => void; allowTemplate?: boolean }) {
  const drafts = useTown((s) => s.snapshot!.status.drafts);
  const creds = useTown((s) => s.snapshot!.credentials);
  const keys = (creds ?? []).filter((c) => c.service !== "github" && c.status !== "error");
  const left = drafts ? Math.max(0, drafts.perDay - drafts.usedToday) : 0;
  const platformOk = !!drafts?.available && (drafts.perDay === 0 || left > 0);
  const label = (svc: string) => (svc === "anthropic" ? "Claude" : svc === "openai" ? "OpenAI" : "Gemini");
  return (
    <fieldset className="draft-source">
      <legend>How should we write their instructions?</legend>
      {allowTemplate && (
        <label className="check">
          <input type="radio" name="draft-source" checked={value === "template"} onChange={() => onChange("template")} />
          <span>
            <b>From the template and your words</b> <small className="muted">· free, instant</small>
          </span>
        </label>
      )}
      <label className="check">
        <input type="radio" name="draft-source" checked={value === "platform"} disabled={!platformOk} onChange={() => onChange("platform")} />
        <span>
          <b>✨ Write with AI</b>{" "}
          <small className="muted">
            {drafts?.available
              ? `· Agentopia's Claude · about ${fmtUsd(drafts.estimateUsd)} from your plan${drafts.perDay ? ` · ${left} of ${drafts.perDay} left today` : ""}`
              : "· not available on this server"}
          </small>
        </span>
      </label>
      {keys.map((k) => (
        <label key={k.id} className="check">
          <input type="radio" name="draft-source" checked={value === k.id} onChange={() => onChange(k.id)} />
          <span>
            <b>✨ Write with AI using your {label(k.service)} key</b> <small className="muted">· “{k.label}” · billed by {label(k.service)}, not your plan</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Who wrote the draft and what it cost, in one line. */
export function DraftReceipt({ draft }: { draft: EmployeeDraft }) {
  const text =
    draft.source === "template"
      ? "📄 Free draft from the template and your words"
      : draft.cached
        ? `♻️ Same as your earlier AI draft (${draft.model}) · no new charge`
        : draft.billing === "own"
          ? `✨ Written by ${draft.model} on your own key · billed by that provider`
          : `✨ Written by ${draft.model} on Agentopia's Claude · ${draft.costUsd !== null ? fmtUsd(draft.costUsd) : "cost unknown"} from your plan`;
  return <small className="draft-receipt muted">{text}</small>;
}
