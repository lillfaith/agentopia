import { useEffect, useState } from "react";
import type { InstructionProfile } from "../../../shared/types";
import { markdownToProfile, profileProblems, profileToMarkdown } from "../../../shared/profile";

/**
 * The employee's instructions, in two views of the same document:
 *   Simple:   one box per section, responsibilities as a list.
 *   AGENTS.md: the whole profile as Markdown, for people who like to write it themselves.
 * Switching views never loses text (unknown headings are kept under Operating instructions).
 */
export function InstructionsEditor({ value, onChange, compact }: { value: InstructionProfile; onChange: (v: InstructionProfile) => void; compact?: boolean }) {
  const [mode, setMode] = useState<"simple" | "markdown">("simple");
  const [md, setMd] = useState(() => profileToMarkdown(value));
  // Keep the Markdown view in step when the structured value changes from outside.
  useEffect(() => {
    if (mode === "simple") setMd(profileToMarkdown(value));
  }, [value, mode]);
  const set = <K extends keyof InstructionProfile>(k: K, v: InstructionProfile[K]) => onChange({ ...value, [k]: v });
  const problems = profileProblems(value);

  return (
    <div className="instructions">
      <div className="row between">
        <div className="seg">
          <button type="button" className={mode === "simple" ? "on" : ""} onClick={() => setMode("simple")}>
            Simple
          </button>
          <button
            type="button"
            className={mode === "markdown" ? "on" : ""}
            onClick={() => {
              setMd(profileToMarkdown(value));
              setMode("markdown");
            }}
          >
            AGENTS.md
          </button>
        </div>
        <small className="muted">Agentopia's safety rules and approvals always come first.</small>
      </div>

      {mode === "markdown" ? (
        <label>
          Instructions document
          <textarea
            className="mono md-editor"
            rows={compact ? 14 : 20}
            spellCheck={false}
            value={md}
            onChange={(e) => {
              setMd(e.target.value);
              onChange(markdownToProfile(e.target.value, value.role));
            }}
          />
          <small className="muted">Sections: # Job title, ## Role, ## Personality, ## Responsibilities (- bullets), ## Operating instructions, ## Task-specific instructions, ## Reference notes.</small>
        </label>
      ) : (
        <>
          <label>
            Role <small className="muted">who they are and what good work looks like</small>
            <textarea rows={compact ? 3 : 4} value={value.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} placeholder="You are a … You help the owner by …" />
          </label>
          <label>
            Personality
            <input value={value.personality} onChange={(e) => set("personality", e.target.value)} placeholder="e.g. Upbeat, precise, never pushy" />
          </label>
          <ListEditor label="Responsibilities" items={value.responsibilities} onChange={(v) => set("responsibilities", v)} placeholder="e.g. Write three title options per video" />
          <label>
            Operating instructions <small className="muted">how they work: formats, tone, always / never</small>
            <textarea rows={3} value={value.operatingInstructions} onChange={(e) => set("operatingInstructions", e.target.value)} placeholder="e.g. Lead with a summary. Link every source." />
          </label>
          <details className="mini">
            <summary>More: task-specific instructions & reference notes</summary>
            <label>
              Task-specific instructions <small className="muted">for particular kinds of jobs</small>
              <textarea rows={3} value={value.taskInstructions} onChange={(e) => set("taskInstructions", e.target.value)} placeholder={"e.g. When writing a script: open with a 15-second hook.\nWhen pricing: compare three shops."} />
            </label>
            <label>
              Reference notes <small className="muted">facts they should always remember</small>
              <textarea rows={3} value={value.referenceNotes} onChange={(e) => set("referenceNotes", e.target.value)} placeholder="e.g. Brand: cosy, lowercase. Products: … Audience: …" />
            </label>
            <small className="muted">They also keep their own notes between jobs (Memory equipment), which you can read and delete on their Now tab.</small>
          </details>
        </>
      )}
      {problems.length > 0 && <div className="error-box">{problems.join(" ")}</div>}
    </div>
  );
}

function ListEditor({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft("");
  };
  return (
    <div className="list-editor">
      <span className="label-text">{label}</span>
      {items.map((item, i) => (
        <div key={i} className="row gap-s list-item">
          <input value={item} maxLength={200} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" className="btn ghost" aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      {items.length < 20 && (
        <div className="row gap-s list-item">
          <input
            value={draft}
            maxLength={200}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="btn" disabled={!draft.trim()} onClick={add}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}
