import { GITHUB_TOOLS } from "../agents/github.js";
import type { SkillDefinition } from "./types.js";

export const github: SkillDefinition = {
  id: "github",
  label: "GitHub",
  icon: "🐙",
  category: "coding",
  description:
    "Read repositories, files, issues and pull requests with your GitHub token. Opening issues, commenting and opening pull requests always wait for your approval.",
  status: "available",
  tools: GITHUB_TOOLS,
  prompt:
    "GitHub skill: you can read repositories, files, issues and pull requests the owner's token can see. " +
    "Read before you write. Opening an issue, commenting or opening a pull request waits for the owner's approval, so explain why in the request.",
  costNote: "No fee from Agentopia; uses your GitHub token and its rate limits. Needs a GitHub token set on the villager.",
  verificationCheck: null,
};
