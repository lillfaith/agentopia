import { useState } from "react";
import type { AIProvider, Agent, CredentialInfo, CredentialService } from "../../../shared/types";
import { api } from "../api/client";
import { useTown } from "../state/store";

export const SERVICE_LABEL: Record<CredentialService, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  gemini: "Gemini",
  github: "GitHub",
};
const SERVICE_ICON: Record<CredentialService, string> = { anthropic: "✳️", openai: "🌀", gemini: "✨", github: "🐙" };
const SERVICE_HELP: Record<CredentialService, string> = {
  anthropic: "An Anthropic API key (starts with sk-ant-). Create one at console.anthropic.com.",
  openai: "An OpenAI API key (starts with sk-). Works with GPT and Codex models. Create one at platform.openai.com.",
  gemini: "A Gemini API key from Google AI Studio (aistudio.google.com).",
  github: "A GitHub personal access token. Fine-grained tokens let you pick exactly which repositories a villager can see.",
};

export interface AiSetupValue {
  provider: AIProvider;
  credentialId: string | null;
  model: string;
  githubCredentialId: string | null;
  priceIn: string;
  priceOut: string;
}

export function aiSetupFrom(agent: Pick<Agent, "provider" | "credentialId" | "model" | "githubCredentialId" | "customPrices">): AiSetupValue {
  return {
    provider: agent.provider,
    credentialId: agent.credentialId,
    model: agent.model,
    githubCredentialId: agent.githubCredentialId,
    priceIn: agent.customPrices ? String(agent.customPrices.inputPerMTok) : "",
    priceOut: agent.customPrices ? String(agent.customPrices.outputPerMTok) : "",
  };
}

/** The fields the hire / update API takes. */
export function aiSetupPayload(v: AiSetupValue) {
  const prices = v.priceIn.trim() && v.priceOut.trim() ? { inputPerMTok: Number(v.priceIn), outputPerMTok: Number(v.priceOut) } : null;
  return { provider: v.provider, credentialId: v.credentialId, model: v.model.trim(), githubCredentialId: v.githubCredentialId, customPrices: v.provider === "anthropic" ? null : prices };
}

/**
 * "Thinks with": Agentopia's Claude (included in the plan) or one of the owner's own keys,
 * the model, and, when the villager has the GitHub skill, which GitHub token it uses.
 */
export function AiSetup({ value, onChange, skills }: { value: AiSetupValue; onChange: (v: AiSetupValue) => void; skills: string[] }) {
  const status = useTown((s) => s.snapshot!.status);
  const creds = useTown((s) => s.snapshot!.credentials ?? []);
  const aiKeys = creds.filter((c) => c.service !== "github");
  const ghKeys = creds.filter((c) => c.service === "github");
  const cred = aiKeys.find((c) => c.id === value.credentialId);
  const platformModels = status.models.filter((m) => !status.allowedModels || status.allowedModels.includes(m.id));
  const [customModel, setCustomModel] = useState(() => !!cred && !!value.model && !cred.models.includes(value.model));

  const pickSource = (id: string) => {
    if (!id) return onChange({ ...value, provider: "anthropic", credentialId: null, model: platformModels[0]?.id ?? value.model });
    const c = aiKeys.find((k) => k.id === id)!;
    const keep = c.service === value.provider && (c.models.includes(value.model) || c.models.length === 0);
    setCustomModel(c.models.length === 0);
    onChange({ ...value, provider: c.service as AIProvider, credentialId: c.id, model: keep ? value.model : (c.models[0] ?? "") });
  };

  return (
    <div className="ai-setup">
      <label>
        Thinks with
        <select value={value.credentialId ?? ""} onChange={(e) => pickSource(e.target.value)}>
          <option value="">Agentopia's Claude (included in your plan)</option>
          {aiKeys.map((k) => (
            <option key={k.id} value={k.id}>
              {SERVICE_ICON[k.service]} {SERVICE_LABEL[k.service]}, your key “{k.label}” ({k.hint})
            </option>
          ))}
        </select>
      </label>
      {!aiKeys.length && (
        <small className="muted">
          To use your own Claude, OpenAI or Gemini key,{" "}
          <button className="link" type="button" onClick={() => useTown.getState().openPanel("settings")}>
            add it in Settings → API keys
          </button>
          .
        </small>
      )}
      <label>
        Model
        {!cred ? (
          <select value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })}>
            {platformModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}: ${m.inputPerMTok}/${m.outputPerMTok} per M tokens
              </option>
            ))}
          </select>
        ) : customModel || !cred.models.length ? (
          <span className="row gap-s">
            <input value={value.model} placeholder="model id, e.g. from your provider's docs" onChange={(e) => onChange({ ...value, model: e.target.value })} />
            {cred.models.length > 0 && (
              <button className="btn ghost" type="button" onClick={() => setCustomModel(false)}>
                List
              </button>
            )}
          </span>
        ) : (
          <select
            value={value.model}
            onChange={(e) => (e.target.value === "__other" ? setCustomModel(true) : onChange({ ...value, model: e.target.value }))}
          >
            {cred.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value="__other">Other model…</option>
          </select>
        )}
      </label>
      {cred && (
        <small className="muted">
          Billed to your {SERVICE_LABEL[cred.service]} account, not your Agentopia plan. Your villager's daily cap, approvals and Stop still apply.
        </small>
      )}
      {cred && cred.service !== "anthropic" && (
        <div className="grid2">
          <label>
            Input price ($ per M tokens)
            <input type="number" min={0} step={0.01} placeholder="for cost estimates" value={value.priceIn} onChange={(e) => onChange({ ...value, priceIn: e.target.value })} />
          </label>
          <label>
            Output price ($ per M tokens)
            <input type="number" min={0} step={0.01} placeholder="for cost estimates" value={value.priceOut} onChange={(e) => onChange({ ...value, priceOut: e.target.value })} />
          </label>
          <small className="muted span2">
            Optional. Agentopia doesn't know {SERVICE_LABEL[cred.service]} prices, so without these it estimates high ($10/$50 per M) and caps bite early.
          </small>
        </div>
      )}
      {skills.includes("github") && (
        <label>
          GitHub token
          <select value={value.githubCredentialId ?? ""} onChange={(e) => onChange({ ...value, githubCredentialId: e.target.value || null })}>
            <option value="">None (GitHub tools will ask for one)</option>
            {ghKeys.map((k) => (
              <option key={k.id} value={k.id}>
                🐙 “{k.label}” ({k.hint}){k.statusDetail ? `: ${k.statusDetail}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/** Settings → API keys: add, check and remove the owner's own keys. Secrets never come back. */
export function ApiKeys() {
  const creds = useTown((s) => s.snapshot!.credentials ?? []);
  const agents = useTown((s) => s.snapshot!.agents);
  const push = useTown((s) => s.pushToast);
  const load = useTown((s) => s.load);
  const [form, setForm] = useState({ service: "openai" as CredentialService, label: "", secret: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      await load();
      push({ tone: "good", text: ok });
    } catch (e) {
      push({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const usedBy = (c: CredentialInfo) => agents.filter((a) => !a.archived && (a.credentialId === c.id || a.githubCredentialId === c.id)).map((a) => a.name);

  return (
    <section className="card form">
      <h3>API keys</h3>
      <p className="muted small">
        Let villagers work with your own Claude, OpenAI or Gemini account, or reach your GitHub. Keys are checked when you add them, stored encrypted, and never shown again.
        Work on your own key is billed by that provider and doesn't count toward your Agentopia plan.
      </p>
      {creds.length > 0 && (
        <ul className="key-list">
          {creds.map((c) => (
            <li key={c.id}>
              <span className="key-main">
                <b>
                  {SERVICE_ICON[c.service]} {SERVICE_LABEL[c.service]} · {c.label}
                </b>
                <small className="muted mono">{c.hint}</small>
                <small className={c.status === "error" ? "bad-text" : "muted"}>
                  {c.status === "ok" ? "✓ " : c.status === "error" ? "⚠ " : ""}
                  {c.statusDetail ?? "Not checked yet"}
                  {usedBy(c).length ? ` · used by ${usedBy(c).join(", ")}` : ""}
                </small>
              </span>
              <span className="row gap-s">
                <button className="btn ghost" disabled={busy === c.id} onClick={() => run(c.id, () => api.checkCredential(c.id), "Key checked")}>
                  Check
                </button>
                {confirming === c.id ? (
                  <button
                    className="btn danger"
                    disabled={busy === c.id}
                    onClick={() => run(c.id, () => api.deleteCredential(c.id), usedBy(c).length ? "Key removed; its villagers went back to Agentopia's Claude" : "Key removed").then(() => setConfirming(null))}
                  >
                    Remove for good
                  </button>
                ) : (
                  <button className="btn ghost danger" onClick={() => setConfirming(c.id)}>
                    Remove
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid2">
        <label>
          Service
          <select value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value as CredentialService })}>
            {(["anthropic", "openai", "gemini", "github"] as CredentialService[]).map((s) => (
              <option key={s} value={s}>
                {SERVICE_ICON[s]} {SERVICE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input value={form.label} maxLength={40} placeholder="e.g. Work account" onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </label>
      </div>
      <label>
        Key or token
        <input type="password" autoComplete="off" spellCheck={false} value={form.secret} placeholder="paste it here" onChange={(e) => setForm({ ...form, secret: e.target.value })} />
      </label>
      <small className="muted">{SERVICE_HELP[form.service]}</small>
      <button
        className="btn primary"
        disabled={busy === "new" || !form.label.trim() || form.secret.trim().length < 8}
        onClick={() =>
          run("new", () => api.addCredential({ service: form.service, label: form.label.trim(), secret: form.secret.trim() }), `${SERVICE_LABEL[form.service]} key added`).then(() =>
            setForm((f) => ({ ...f, label: "", secret: "" })),
          )
        }
      >
        {busy === "new" ? "Checking…" : "Check & save key"}
      </button>
    </section>
  );
}
