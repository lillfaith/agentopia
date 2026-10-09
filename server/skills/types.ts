import type { SkillCategory } from "../../shared/types.js";
import type { ToolDefinition } from "../agents/tools.js";

/**
 * A skill is a self-contained capability module: the tools it unlocks, guidance
 * appended to the agent's system prompt, and honest metadata (status, cost,
 * how it is verified). Adding a capability = adding one file to server/skills/
 * and listing it in index.ts.
 */
export interface SkillDefinition {
  id: string;
  label: string;
  icon: string;
  category: SkillCategory;
  description: string;
  /** "planned" skills are visible but cannot be enabled until an integration exists. */
  status: "available" | "planned";
  tools: ToolDefinition[];
  /** Appended to the system prompt of agents that have this skill. Keep it stable (cache-friendly). */
  prompt: string | null;
  costNote: string;
  /** verify:live check id that exercises this skill against the real API. */
  verificationCheck: string | null;
}
