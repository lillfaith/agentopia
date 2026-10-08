import { email as emailTool } from "../agents/tools.js";
import type { SkillDefinition } from "./types.js";

export const email: SkillDefinition = {
  id: "email",
  label: "Email (approval)",
  icon: "✉️",
  category: "communication",
  description:
    "Request to email someone outside the company. Always waits for your approval. " +
    "PLACEHOLDER: no mail provider is connected yet, so approved emails are recorded, not sent.",
  status: "available",
  tools: [emailTool],
  prompt: null,
  costNote: "Free (no integration yet).",
  verificationCheck: null,
};
