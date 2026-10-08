import { delegate } from "../agents/tools.js";
import type { SkillDefinition } from "./types.js";

export const delegation: SkillDefinition = {
  id: "delegation",
  label: "Delegation",
  icon: "📨",
  category: "coordination",
  description: "Assign new tasks to other villagers. Depth-limited; agents cannot delegate to themselves.",
  status: "available",
  tools: [delegate],
  prompt:
    "Delegation skill: when a specialist colleague is better suited, delegate a complete, self-contained brief with delegate_task. " +
    "Do not delegate work you can finish yourself in this task.",
  costNote: "Free itself; the delegated task costs whatever the recipient spends.",
  verificationCheck: "client_tools",
};
