import type { SkillDefinition } from "./types.js";

export const writing: SkillDefinition = {
  id: "writing",
  label: "Writing & editing",
  icon: "✍️",
  category: "writing",
  description: "Drafting, rewriting and editing text. Uses the model alone — no external tools.",
  status: "available",
  tools: [],
  prompt:
    "Writing skill: write clearly for the stated audience, keep claims grounded in the material you were given, and offer distinct variants when useful.",
  costNote: "Tokens only.",
  verificationCheck: "messages",
};
