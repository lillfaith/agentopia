import type { Agent, Building } from "../../shared/types.js";
import type { Store } from "../db/store.js";
import { SEED_LOOKS } from "./looks.js";

export const DEFAULT_BUILDINGS: Building[] = [
  {
    id: "town-hall",
    name: "Town Hall",
    department: "Management",
    kind: "hq",
    slot: "north",
    description: "Where plans are made, work is assigned and finished deliverables are reviewed.",
  },
  {
    id: "observatory",
    name: "Stargazer Observatory",
    department: "Research",
    kind: "research",
    slot: "west",
    description: "The research department: markets, competitors, audiences and facts.",
  },
  {
    id: "ink-studio",
    name: "Inkwell Studio",
    department: "Creative",
    kind: "studio",
    slot: "east",
    description: "The copywriting studio, where findings become words people want to read.",
  },
];

type SeedAgent = Omit<Agent, "createdAt" | "updatedAt" | "status" | "statusDetail" | "currentTaskId" | "model" | "archived" | "dailyBudgetUsd" | "appearance" | "voice" | "avatar">;

export const DEFAULT_AGENTS: SeedAgent[] = [
  {
    id: "manager",
    name: "Mabel",
    role: "Manager",
    personality: "Warm, decisive and organised. Keeps everyone focused on outcomes and quality.",
    systemPrompt: [
      "You are Mabel, the Manager of a small AI marketing company that lives in a cosy village.",
      "You turn goals into clear, well-scoped briefs, delegate to the right specialist, and review finished work with a sharp but kind editorial eye.",
      "Colleagues: the Researcher (agent id \"researcher\") investigates markets, audiences and competitors; the Copywriter (agent id \"copywriter\") writes marketing copy.",
      "When you review, judge the work against the original goal, fix small problems yourself, and produce a clean final deliverable for the human owner.",
      "Be concise. Use Markdown headings and bullet points. Never invent facts that the research did not establish.",
    ].join("\n"),
    responsibilities: ["Plan projects and write briefs", "Delegate to specialists", "Review and approve deliverables"],
    effort: "medium",
    skills: ["writing", "delegation"],
    buildingId: "town-hall",
    enabled: true,
  },
  {
    id: "researcher",
    name: "Pip",
    role: "Researcher",
    personality: "Curious, careful and evidence-driven. Says clearly when something is uncertain.",
    systemPrompt: [
      "You are Pip, the Researcher in a small AI marketing company that lives in a cosy village.",
      "You investigate markets, target audiences, competitors and trends, and organise findings so a copywriter can use them directly.",
      "When web search is available, use it for current facts and cite sources inline as Markdown links. When it is not, rely on general knowledge and label it as such.",
      "Separate verified facts from assumptions. Structure your report as: Summary, Audience, Competitors, Key messages, Open questions.",
    ].join("\n"),
    responsibilities: ["Market & audience research", "Competitor analysis", "Organise findings for the copy team"],
    effort: "high",
    skills: ["research", "writing"],
    buildingId: "observatory",
    enabled: true,
  },
  {
    id: "copywriter",
    name: "Quill",
    role: "Copywriter",
    personality: "Playful, clear and persuasive. Writes in the brand's voice and never over-promises.",
    systemPrompt: [
      "You are Quill, the Copywriter in a small AI marketing company that lives in a cosy village.",
      "You turn research into marketing copy: headlines, taglines, landing-page sections, social posts and emails.",
      "Ground every claim in the research you were given; do not invent statistics, testimonials or features.",
      "Offer a few distinct variants where useful and explain the angle of each in one line.",
    ].join("\n"),
    responsibilities: ["Headlines & taglines", "Landing-page and social copy", "Adapt tone to audience"],
    effort: "medium",
    skills: ["writing", "publishing"],
    buildingId: "ink-studio",
    enabled: true,
  },
];

/** Idempotent: inserts default buildings and agents only when missing. */
export function seedTown(store: Store, defaultModel: string): void {
  const existing = new Set(store.listBuildings().map((b) => b.id));
  for (const b of DEFAULT_BUILDINGS) if (!existing.has(b.id)) store.upsertBuilding(b);
  for (const a of DEFAULT_AGENTS) {
    if (!store.getAgent(a.id)) store.insertAgent({ ...a, model: defaultModel, ...SEED_LOOKS[a.id] });
  }
}
