import type { Agent, SkillInfo } from "../../shared/types.js";
import type { Store } from "../db/store.js";
import { toolInfo, type LocalTool } from "../agents/tools.js";
import type { HostedTool, ToolSpec } from "../llm/provider.js";
import { coding } from "./coding.js";
import { delegation } from "./delegation.js";
import { email } from "./email.js";
import { memory } from "./memory.js";
import { imageGeneration, modeling3d } from "./planned.js";
import { publishing } from "./publishing.js";
import { research } from "./research.js";
import type { SkillDefinition } from "./types.js";
import { writing } from "./writing.js";

export type { SkillDefinition } from "./types.js";

/** Registry order is display order. */
export const SKILLS: SkillDefinition[] = [research, writing, delegation, memory, coding, publishing, email, imageGeneration, modeling3d];

export function getSkill(id: string): SkillDefinition | undefined {
  return SKILLS.find((s) => s.id === id);
}

export function isEnableableSkill(id: string): boolean {
  return getSkill(id)?.status === "available";
}

export function skillInfo(): SkillInfo[] {
  return SKILLS.map((s) => ({
    id: s.id,
    label: s.label,
    icon: s.icon,
    category: s.category,
    description: s.description,
    status: s.status,
    tools: s.tools.map(toolInfo),
    costNote: s.costNote,
    verificationCheck: s.verificationCheck,
  }));
}

export interface AgentCapabilities {
  local: LocalTool[];
  specs: ToolSpec[];
  hosted: HostedTool[];
  /** Skill guidance for the system prompt, in registry order (stable). */
  prompts: string[];
}

/** Resolve an agent's skills into the tools offered to the model. Unknown/planned skills contribute nothing. */
export function capabilitiesFor(store: Store, agent: Agent): AgentCapabilities {
  const local = new Map<string, LocalTool>();
  const hosted = new Set<HostedTool>();
  const prompts: string[] = [];
  for (const skill of SKILLS) {
    if (!agent.skills.includes(skill.id) || skill.status !== "available") continue;
    if (skill.prompt) prompts.push(skill.prompt);
    for (const tool of skill.tools) {
      if (tool.kind === "hosted") hosted.add(tool.hosted);
      else local.set(tool.id, tool);
    }
  }
  const tools = [...local.values()];
  return {
    local: tools,
    specs: tools.map((t) => ({ name: t.id, description: t.description, inputSchema: t.inputSchema({ store, agent }) })),
    hosted: [...hosted],
    prompts,
  };
}
