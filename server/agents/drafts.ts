import { z } from "zod";
import type { AgentTemplate, EmployeeDraft } from "../../shared/types.js";
import { PROFILE_LIMITS } from "../../shared/profile.js";
import type { Config } from "../config.js";
import type { Store } from "../db/store.js";
import { estimateCostUsd } from "../llm/models.js";
import type { LLMProvider } from "../llm/provider.js";
import { SKILLS } from "../skills/index.js";

/** Usage from hiring drafts is recorded under this id (it isn't an employee). */
export const HIRING_DESK = "hiring-desk";

export interface DraftInput {
  description: string;
  role?: string;
  name?: string;
  template?: AgentTemplate;
}

interface DraftDeps {
  store: Store;
  config: Pick<Config, "allowedModels">;
  /** The platform provider, or null when AI drafting isn't possible right now. */
  provider: LLMProvider | null;
  holdReason: string | null;
}

const aiDraft = z.object({
  role: z.string().trim().min(1).max(PROFILE_LIMITS.role),
  personality: z.string().max(PROFILE_LIMITS.personality).default(""),
  systemPrompt: z.string().trim().min(1).max(PROFILE_LIMITS.systemPrompt),
  responsibilities: z.array(z.string().trim().min(1).max(PROFILE_LIMITS.responsibility)).max(PROFILE_LIMITS.responsibilities).default([]),
  operatingInstructions: z.string().max(PROFILE_LIMITS.operatingInstructions).default(""),
  taskInstructions: z.string().max(PROFILE_LIMITS.taskInstructions).default(""),
  skills: z.array(z.string()).max(20).default([]),
});

/**
 * Turn "what should this employee do?" into an editable first draft of its instructions and
 * equipment. Uses Agentopia's own Claude (cheapest allowed model, a few tenths of a cent) when it
 * can; otherwise builds the draft from the template. The result is only ever a suggestion: the
 * owner reviews it, and nothing is saved until they hire or press Save.
 */
export async function draftEmployee(deps: DraftDeps, input: DraftInput): Promise<EmployeeDraft> {
  const fallback = templateDraft(input);
  const provider = deps.provider;
  if (!provider || provider.simulated || provider.id === "unconfigured") {
    return { ...fallback, note: deps.holdReason ? `${deps.holdReason}, so this draft is based on the template. Edit it freely.` : "Drafted from the template (AI drafting isn't available here). Edit it freely." };
  }
  const model = draftModel(deps.config.allowedModels);
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
    input.name ? `Employee name: ${input.name}` : null,
    input.template ? `Starting template: ${input.template.role}: ${input.template.description}` : null,
    `What the owner wants this employee to do:\n${input.description}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    const res = await provider.generate({ model, effort: "low", system, messages: [provider.userMessage(brief)], tools: [], hostedTools: [], maxTokens: 1500 });
    const cost = estimateCostUsd(res.servedModel, res.usage);
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
      billing: "platform",
    });
    deps.store.addEvent({
      type: "usage.recorded",
      message: `Drafted an employee's instructions · ~$${cost.toFixed(4)} (${res.servedModel})`,
      data: { ...res.usage, costUsd: cost, model: res.servedModel, requestId: res.requestId, billing: "platform", purpose: "employee-draft" },
    });
    const json = res.text.match(/\{[\s\S]*\}/)?.[0];
    const parsed = json ? aiDraft.safeParse(JSON.parse(json)) : null;
    if (!parsed?.success) return { ...fallback, note: "The AI draft didn't come back in a usable shape, so this one is based on the template." };
    const d = parsed.data;
    const skills = sanitizeSkills(d.skills);
    return {
      role: input.role?.trim() || d.role,
      personality: d.personality,
      systemPrompt: d.systemPrompt,
      responsibilities: d.responsibilities,
      operatingInstructions: d.operatingInstructions,
      taskInstructions: d.taskInstructions,
      skills: skills.length ? skills : fallback.skills,
      source: "ai",
      note: null,
    };
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

function draftModel(allowed: string[] | null): string {
  const cheap = "claude-haiku-5-5";
  if (!allowed || allowed.includes(cheap)) return cheap;
  return allowed[0];
}

const KEYWORDS: [RegExp, string][] = [
  [/research|find|investigat|compar|market|competitor|news|trend|fact|source/i, "research"],
  [/code|program|script|develop|software|debug|data|analy|spreadsheet|numbers|calculat|chart/i, "coding"],
  [/delegat|manage|coordinat|team|assign/i, "delegation"],
  [/github|repo|pull request|issue/i, "github"],
  [/publish|post to|social media|schedule posts/i, "publishing"],
  [/email|newsletter|reply to customers|outreach/i, "email"],
];

/** Draft without AI: the template's text plus the owner's own words. */
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
    systemPrompt: `${base}\n\nWhat the owner hired you for: ${description}`.slice(0, PROFILE_LIMITS.systemPrompt),
    responsibilities: t?.responsibilities?.length ? t.responsibilities : fromWords,
    operatingInstructions: t?.operatingInstructions ?? "Lead with the answer, keep it practical, and say plainly when you are unsure.",
    taskInstructions: t?.taskInstructions ?? "",
    skills: sanitizeSkills(t?.skills?.length ? t.skills : KEYWORDS.filter(([re]) => re.test(description)).map(([, id]) => id)),
    source: "template",
    note: null,
  };
}
