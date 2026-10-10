import { useState } from "react";
import type { AIProvider, SkillInfo } from "../../../shared/types";
import { useTown } from "../state/store";
import { Badge } from "./common";

/** What an employee's equipment needs to know about its setup. */
export interface EquipmentContext {
  provider: AIProvider;
  githubCredentialId: string | null;
}

type Readiness = "working" | "needs-connection" | "coming-soon";

export function readiness(s: SkillInfo, ctx: EquipmentContext): Readiness {
  if (s.status === "planned") return "coming-soon";
  if (s.connection === "github" && !ctx.githubCredentialId) return "needs-connection";
  return "working";
}

const READY_LABEL: Record<Readiness, string> = { working: "Ready", "needs-connection": "Needs a connection", "coming-soon": "Coming soon" };
const READY_TONE: Record<Readiness, string> = { working: "good", "needs-connection": "warn", "coming-soon": "muted" };

/**
 * Capabilities as a compact grid of equipment. Click a tile to see what it does, what it costs,
 * what it needs and which of its actions wait for approval; equip or unequip from there.
 * The server enforces the same allowlist: equipping here is the only way an employee gets a tool.
 */
export function EquipmentGrid({ value, onChange, ctx }: { value: string[]; onChange: (v: string[]) => void; ctx: EquipmentContext }) {
  const skills = useTown((s) => s.snapshot!.status.skills);
  const verifications = useTown((s) => s.snapshot!.status.verifications);
  const [open, setOpen] = useState<string | null>(null);
  const selected = skills.find((s) => s.id === open) ?? null;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="equipment">
      <div className="equip-grid" role="list">
        {skills.map((s) => {
          const r = readiness(s, ctx);
          const on = value.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              role="listitem"
              className={`equip-tile ${on ? "on" : ""} ${open === s.id ? "open" : ""} ready-${r}`}
              onClick={() => setOpen(open === s.id ? null : s.id)}
              aria-pressed={on}
              title={`${s.label}: ${READY_LABEL[r]}${on ? " (equipped)" : ""}`}
            >
              <span className="equip-icon">{s.icon}</span>
              <span className="equip-name">{s.shortLabel ?? s.label}</span>
              {on && <span className="equip-check">✓</span>}
              <span className={`equip-dot ${r}`} aria-hidden />
            </button>
          );
        })}
      </div>
      <div className="equip-legend muted small">
        <span><i className="equip-dot working" /> Ready</span>
        <span><i className="equip-dot needs-connection" /> Needs a connection</span>
        <span><i className="equip-dot coming-soon" /> Coming soon</span>
        <span>✓ equipped</span>
      </div>
      {selected && (
        <EquipmentDetail
          skill={selected}
          ready={readiness(selected, ctx)}
          equipped={value.includes(selected.id)}
          verified={selected.verificationCheck ? (verifications.find((v) => v.checkId === selected.verificationCheck)?.ok ?? null) : null}
          onToggle={() => toggle(selected.id)}
          provider={ctx.provider}
        />
      )}
    </div>
  );
}

function EquipmentDetail({ skill, ready, equipped, verified, onToggle, provider }: { skill: SkillInfo; ready: Readiness; equipped: boolean; verified: boolean | null; onToggle: () => void; provider: AIProvider }) {
  const asks = skill.tools.filter((t) => t.requiresApproval);
  const free = skill.tools.filter((t) => !t.requiresApproval);
  return (
    <div className="equip-detail card">
      <div className="row between">
        <b>
          {skill.icon} {skill.label}
        </b>
        <span className="row gap-s">
          <Badge tone={READY_TONE[ready]}>{READY_LABEL[ready]}</Badge>
          {verified !== null && <Badge tone={verified ? "good" : "bad"}>{verified ? "verified live" : "last check failed"}</Badge>}
        </span>
      </div>
      <p className="small">{skill.description}</p>
      <div className="equip-facts small">
        <span>💰 {skill.costNote}</span>
        {skill.connection && <span>🔌 Needs a {skill.connection === "github" ? "GitHub token (Settings → API keys)" : skill.connection} connection</span>}
        {skill.providerNote && provider !== "anthropic" && <span>🤖 {skill.providerNote}</span>}
        {asks.length > 0 && <span>🔐 Always asks you first: {asks.map((t) => t.label).join(", ")}</span>}
        {free.length > 0 && <span>⚡ Works on its own: {free.map((t) => t.label).join(", ")}</span>}
        {skill.tools.some((t) => t.implementation === "placeholder") && <span>📝 Placeholder: approved actions are recorded, nothing is sent yet</span>}
        {ready === "coming-soon" && <span>⏳ You can equip it now; it starts working when the integration ships.</span>}
      </div>
      <button type="button" className={`btn ${equipped ? "" : "primary"}`} onClick={onToggle}>
        {equipped ? "Unequip" : "Equip"}
      </button>
    </div>
  );
}

/**
 * Which of an employee's actions wait for the owner. Sensitive actions always ask (locked);
 * the owner can make other on-server actions ask too. The server applies the same rule.
 */
export function PermissionsList({ skills, value, onChange }: { skills: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const all = useTown((s) => s.snapshot!.status.skills);
  const tools = all.filter((s) => skills.includes(s.id) && s.status === "available").flatMap((s) => s.tools.map((t) => ({ ...t, skill: s })));
  if (!tools.length) return <p className="muted small">This employee only thinks and writes, so there's nothing to approve.</p>;
  return (
    <div className="perm-list">
      {tools.map((t) => {
        const locked = t.requiresApproval;
        const hosted = t.runsOn === "hosted";
        const asks = locked || value.includes(t.id);
        return (
          <label key={t.id} className={`perm-row ${locked ? "locked" : ""}`}>
            <span>
              <b>
                {t.skill.icon} {t.label}
              </b>
              <small className="muted">{locked ? "Always asks you: this can reach people or the outside world." : hosted ? "Runs at the AI provider during a task, so it can't pause for approval." : "Runs on its own unless you switch this on."}</small>
            </span>
            <span className="perm-switch">
              <input
                type="checkbox"
                checked={asks}
                disabled={locked || hosted}
                onChange={(e) => onChange(e.target.checked ? [...value, t.id] : value.filter((x) => x !== t.id))}
              />
              <small>{asks ? "Asks first" : "Automatic"}</small>
            </span>
          </label>
        );
      })}
    </div>
  );
}

const CONNECTIONS: { id: string; label: string; icon: string; service?: "anthropic" | "openai" | "gemini" | "github"; soon?: boolean }[] = [
  { id: "agentopia", label: "Agentopia's Claude", icon: "✳️" },
  { id: "anthropic", label: "Your Claude key", icon: "✳️", service: "anthropic" },
  { id: "openai", label: "OpenAI", icon: "🌀", service: "openai" },
  { id: "gemini", label: "Gemini", icon: "✨", service: "gemini" },
  { id: "github", label: "GitHub", icon: "🐙", service: "github" },
  { id: "gmail", label: "Gmail", icon: "📮", soon: true },
  { id: "youtube", label: "YouTube", icon: "📺", soon: true },
  { id: "shopify", label: "Shopify", icon: "🛍️", soon: true },
];

/** The services an employee can be connected to, and whether each is ready, missing or coming soon. */
export function ConnectionsStrip() {
  const creds = useTown((s) => s.snapshot!.credentials ?? []);
  return (
    <div className="connections">
      <span className="label-text">Connections</span>
      <div className="conn-chips">
        {CONNECTIONS.map((c) => {
          const ok = c.id === "agentopia" || (c.service && creds.some((k) => k.service === c.service && k.status !== "error"));
          const state = c.soon ? "soon" : ok ? "ok" : "off";
          return (
            <span key={c.id} className={`conn-chip ${state}`} title={state === "ok" ? "Connected" : state === "soon" ? "Coming soon" : "Not connected: add a key in Settings → API keys"}>
              {c.icon} {c.label}
              <small>{state === "ok" ? "✓" : state === "soon" ? "soon" : "+ add"}</small>
            </span>
          );
        })}
      </div>
    </div>
  );
}
