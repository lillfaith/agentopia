import { publish } from "../agents/tools.js";
import type { SkillDefinition } from "./types.js";

export const publishing: SkillDefinition = {
  id: "publishing",
  label: "Publishing (approval)",
  icon: "📣",
  category: "publishing",
  description:
    "Request to publish content to a blog or social channel. Always waits for your approval. " +
    "PLACEHOLDER: no channel is connected yet, so approved content is recorded, not posted.",
  status: "available",
  tools: [publish],
  prompt: null,
  costNote: "Free (no integration yet).",
  verificationCheck: null,
};
