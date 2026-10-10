import { createHash } from "node:crypto";
import { z } from "zod";
import type { AgentTemplate, EmployeeDraft } from "../../shared/types.js";
import { recommendedModel } from "../../shared/modelRank.js";
import { PROFILE_LIMITS } from "../../shared/profile.js";
import type { Config } from "../config.js";
import type { Store } from "../db/store.js";
import type { ProviderResolver } from "../llm/keys.js";
import { estimateCostUsd, isKnownModel, modelSpec } from "../llm/models.js";
import type { LLMProvider } from "../llm/provider.js";
import { SKILLS } from "../skills/index.js";

/** Usage from hiring drafts is recorded under this id (it isn't an employee). */
export const HIRING_DESK = "hiring-desk";

export interface DraftInput {
  description: string;
  role?: string;
  template?: AgentTemplate;
  /** "template" = free, no AI call. "ai" = an AI-written draft (only when the owner asks for one). */
  mode?: "template" | "ai";
  /** Write the AI draft with this owner key instead of Agentopia's Claude (billed by that provider). */
  credentialId?: string | null;
}

interface DraftDeps {
  store: Store;
  config: Pick<Config, "allowedModels" | "draftsPerDay">;
  /** The platform provider, or null when Agentopia's Claude can't be used right now. */
  provider: LLMProvider | null;
  resolver?: ProviderResolver;
  holdReason: string | null;
}

/** Typical draft size for the prompt below: ~700 tokens in, ~500 out. */
const TYPICAL = { inputTokens: 700, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 };

/** The model Agentopia's own drafts use: the cheapest Claude the plan allows. */
export function draftModel(allowed: string[] | null): string {
  const cheap = "claude-haiku-5-5";
  if (!allowed || allowed.includes(cheap)) return cheap;
  return [...allowed].sort((a, b) => modelSpec(a).outputPerMTok - modelSpec(b).outputPerMTok)[0];
}

/** Estimated cost of one platform-funded draft, shown before the owner asks for one. */
export function draftEstimateUsd(allowed: string[] | null): number {
  return estimateCostUsd(draftModel(allowed), TYPICAL);
}

/** Platform-funded AI drafts this town has used today (UTC). */
export function platformDraftsToday(store: Store): number {
  const since = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  return Number(store.usageQuery<{ n: number }>("SELECT COUNT(*) AS n FROM usage WHERE agent_id = ? AND billing = 'platform' AND simulated = 0 AND ts >= ?", HIRING_DESK, since)[0]?.n ?? 0);
}

/** For an owner key, an inexpensive general model from the ones that key can use. */
function ownKeyModel(service: "anthropic" | "openai" | "gemini", models: string[]): string {
  if (service === "anthropic") return models.find((m) => m.startsWith("claude-haiku")) ?? recommendedModel("anthropic", models) ?? "claude-haiku-5-5";
  return recommendedModel(service, models) ?? (service === "openai" ? "gpt-5-mini" : "gemini-2.5-flash");
}

// Same request → same draft, at no charge. Per town, kept for a day, at most 100 entries.
const CACHE_TTL_MS = 24 * 3600_000;
const caches = new WeakMap<Store, Map<string, { at: number; draft: EmployeeDraft }>>();
function cacheFor(store: Store) {
  let c = caches.get(store);
  if (!c) caches.set(store, (c = new Map()));
  return c;
}
function cacheKey(input: DraftInput): string {
  return createHash("sha256")
    .update(JSON.stringify([input.description.trim().toLowerCase(), input.role?.trim().toLowerCase() ?? "", input.template?.id ?? "", input.credentialId ?? "platform"]))
    .digest("hex");
}

/** Read the model's JSON leniently: trim what's too long instead of throwing the whole draft away. */
const str = (max: number) => z.preprocess((v) => (v == null ? "" : typeof v === "string" ? v : Array.isArray(v) ? v.join("\n") : String(v)), z.string().transform((x) => x.trim().slice(0, max)));
const list = (maxItems: number, maxLen: number) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : []),
    z.array(z.unknown()).transform((xs) => xs.map((x) => String(x ?? "").replace(/^[-*•\s]+/, "").trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems)),
  );
const aiDraft = z.object({
  role: str(PROFILE_LIMITS.role),
  personality: str(PROFILE_LIMITS.personality),
  systemPrompt: str(PROFILE_LIMITS.systemPrompt).refine((x) => x.length > 0, "systemPrompt is empty"),
  responsibilities: list(PROFILE_LIMITS.responsibilities, PROFILE_LIMITS.responsibility),
  operatingInstructions: str(PROFILE_LIMITS.operatingInstructions),
  taskInstructions: str(PROFILE_LIMITS.taskInstructions),
  skills: list(20, 40),
});

/**
 * Turn "what should this employee do?" into an editable first draft of its instructions and
 * equipment. Only called when the owner asks:
 *   mode "template": free, built from the template and their words, no AI call;
 *   mode "ai": written by the owner's own key (billed by that provider) or by Agentopia's Claude
 *   on the cheapest allowed model (counts toward the plan, at most `draftsPerDay` per town per day).
 * Identical requests are answered from a cache at no charge. The result is only a suggestion:
 * nothing is saved until the owner hires or presses Save.
 */
export async function draftEmployee(deps: DraftDeps, input: DraftInput): Promise<EmployeeDraft> {
  const fallback = templateDraft(input);
  if ((input.mode ?? "ai") === "template") return fallback;

  const cache = cacheFor(deps.store);
  const key = cacheKey(input);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...hit.draft, cached: true, costUsd: 0, note: "Same description as before, so this is the draft you already got (no new charge)." };
  }

  let provider: LLMProvider | null;
  let model: string;
  let billing: "platform" | "own";
  let by: string;
  if (input.credentialId) {
    const cred = deps.store.getCredential(input.credentialId);
    if (!cred || cred.service === "github") return { ...fallback, note: "That key can't write drafts, so this one is from the template (free)." };
    const service = cred.service as "anthropic" | "openai" | "gemini";
    const resolved = deps.resolver?.resolve({ provider: service, credentialId: cred.id, name: "The hiring desk" });
    if (!resolved || "error" in resolved) return { ...fallback, note: `${resolved && "error" in resolved ? resolved.error : "Your key isn't available."} This draft is from the template (free).` };
    provider = resolved.provider;
    model = ownKeyModel(service, cred.models);
    billing = "own";
    by = `your ${service === "anthropic" ? "Claude" : service === "openai" ? "OpenAI" : "Gemini"} key`;
  } else {
    provider = deps.provider;
    if (!provider || provider.simulated || provider.id === "unconfigured") {
      return { ...fallback, note: deps.holdReason ? `${deps.holdReason}, so this draft is from the template (free). Edit it freely.` : "AI drafting isn't available here, so this draft is from the template (free). Edit it freely." };
    }
    if (deps.config.draftsPerDay > 0 && platformDraftsToday(deps.store) >= deps.config.draftsPerDay) {
      return { ...fallback, note: `You've used today's ${deps.config.draftsPerDay} AI drafts on Agentopia's Claude, so this one is from the template (free). Use your own AI key for more, or try again tomorrow.` };
    }
    model = draftModel(deps.config.allowedModels);
    billing = "platform";
    by = "Agentopia's Claude";
  }

  const available = SKILLS.filter((s) => s.status === "available");
  const system = [
    "You write instruction profiles for AI employees in Agentopia, a cosy town where AI employees do real work for their owner.",
    "Given the owner's description, reply with ONLY a JSON object (no prose, no code fence) with these keys:",
    '  "role": short job title (max 6 words)',
    '  "personality": one sentence on tone and manner',
    '  "systemPrompt": 2-4 sentences, second person ("You are …"), defining the role and what good work looks like',
    '  "responsibilities": 3-6 short items',
    '  "operatingInstructions": 2-5 short rules on how to work (formats, tone, what to always or never do)',
    '  "taskInstructions": optional, instructions for specific recurring task types, or ""',
    '  "skills": capability ids the employee needs, chosen ONLY from this list:',
    ...available.map((s) => `     ${s.id}: ${s.description}`),
    "Rules: never claim abilities outside the chosen capabilities (e.g. no posting, sending, trading or purchasing unless listed, and those still need owner approval). Never include API keys, passwords or personal data. Keep it practical and specific to the description.",
  ].join("\n");
  const brief = [
    input.role ? `Job title the owner chose: ${input.role}` : null,
    input.template ? `Starting template: ${input.template.role}: ${input.template.description}` : null,
    `What the owner wants this employee to do:\n${input.description}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    const res = await provider.generate({ model, effort: "low", system, messages: [provider.userMessage(brief)], tools: [], hostedTools: [], maxTokens: 1500 });
    // Claude prices are known; other providers' prices aren't, so those drafts show no dollar figure.
    const known = isKnownModel(res.servedModel);
    const cost = known ? estimateCostUsd(res.servedModel, res.usage) : 0;
    deps.store.recordUsage({
      agentId: HIRING_DESK,
      taskId: null,
      model: res.servedModel,
      ...res.usage,
      webFetchRequests: res.usage.webFetchRequests ?? 0,
      codeExecutions: res.usage.codeExecutions ?? 0,
      costUsd: cost,
      simulated: false,
      requestId: res.requestId,
      requestedModel: model,
      billing,
    });
    deps.store.addEvent({
      type: "usage.recorded",
      message: `Hiring desk drafted an employee's instructions with ${by} · ${known ? `~$${cost.toFixed(4)}` : "billed by the provider"} (${res.servedModel})`,
      data: { ...res.usage, costUsd: cost, model: res.servedModel, requestId: res.requestId, billing, purpose: "employee-draft" },
    });
    const json = res.text.match(/\{[\s\S]*\}/)?.[0];
    let raw: unknown = null;
    try {
      raw = json ? JSON.parse(json) : null;
    } catch {
      raw = null;
    }
    const parsed = raw ? aiDraft.safeParse(raw) : null;
    if (!parsed?.success) {
      const why = parsed ? parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : json ? "not valid JSON" : "no JSON in the reply";
      return { ...fallback, note: `The AI draft couldn't be read (${why.slice(0, 160)}), so this one is based on the template.` };
    }
    const d = parsed.data;
    const skills = sanitizeSkills(d.skills);
    const draft: EmployeeDraft = {
      role: input.role?.trim() || d.role || fallback.role,
      personality: d.personality,
      systemPrompt: d.systemPrompt,
      responsibilities: d.responsibilities,
      operatingInstructions: d.operatingInstructions,
      taskInstructions: d.taskInstructions,
      skills: skills.length ? skills : fallback.skills,
      source: "ai",
      note: null,
      costUsd: known ? cost : null,
      model: res.servedModel,
      billing,
      cached: false,
    };
    cache.set(key, { at: Date.now(), draft });
    if (cache.size > 100) cache.delete(cache.keys().next().value!);
    return draft;
  } catch (err) {
    return { ...fallback, note: `AI drafting failed (${err instanceof Error ? err.message.slice(0, 120) : "error"}), so this draft is based on the template.` };
  }
}

/** Only capabilities that exist and can be enabled; "memory" and "writing" are sensible defaults. */
export function sanitizeSkills(ids: string[]): string[] {
  const ok = new Set(SKILLS.filter((s) => s.status === "available").map((s) => s.id));
  const out = [...new Set(ids.filter((id) => ok.has(id)))];
  for (const base of ["writing", "memory"]) if (!out.includes(base)) out.push(base);
  return out;
}

const KEYWORDS: [RegExp, string][] = [
  [/research|find|investigat|compar|market|competitor|news|trend|fact|source/i, "research"],
  [/code|program|script|develop|software|debug|data|analy|spreadsheet|numbers|calculat|chart/i, "coding"],
  [/delegat|manage|coordinat|team|assign/i, "delegation"],
  [/github|repo|pull request|issue/i, "github"],
  [/publish|post to|social media|schedule posts/i, "publishing"],
  [/email|newsletter|reply to customers|outreach/i, "email"],
];

/** Draft without AI (free): the template's text plus the owner's own words. */
export function templateDraft(input: DraftInput): EmployeeDraft {
  const t = input.template;
  const role = input.role?.trim() || t?.role || "Custom Employee";
  const article = /^[aeiou]/i.test(role) ? "an" : "a";
  const description = input.description.trim();
  const fromWords = description
    .split(/\n|;|\. /)
    .map((x) => x.replace(/^[-*•\d.)\s]+/, "").trim().replace(/\.$/, ""))
    .filter((x) => x.length > 3)
    .slice(0, 5)
    .map((x) => x.slice(0, PROFILE_LIMITS.responsibility));
  const base = t?.systemPrompt?.trim() || `You are ${article} ${role} at a small AI company that lives in a cosy village.`;
  return {
    role,
    personality: t?.personality ?? "Friendly, focused and honest about what you don't know.",
    systemPrompt: (description ? `${base}\n\nWhat the owner hired you for: ${description}` : base).slice(0, PROFILE_LIMITS.systemPrompt),
    responsibilities: t?.responsibilities?.length ? t.responsibilities : fromWords,
    operatingInstructions: t?.operatingInstructions ?? "Lead with the answer, keep it practical, and say plainly when you are unsure.",
    taskInstructions: t?.taskInstructions ?? "",
    skills: sanitizeSkills(t?.skills?.length ? t.skills : KEYWORDS.filter(([re]) => re.test(description)).map(([, id]) => id)),
    source: "template",
    note: null,
    costUsd: 0,
    model: null,
    billing: "free",
    cached: false,
  };
}
