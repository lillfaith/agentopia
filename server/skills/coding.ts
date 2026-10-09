import { codeExecution } from "../agents/tools.js";
import type { SkillDefinition } from "./types.js";

export const coding: SkillDefinition = {
  id: "coding",
  label: "Coding & data (sandbox)",
  icon: "💻",
  category: "coding",
  description:
    "Write and run Python/shell in Anthropic's isolated sandbox for analysis, calculations and prototypes. " +
    "It has no internet and no access to your computer, repositories or servers.",
  status: "available",
  tools: [codeExecution],
  prompt:
    "Coding skill: you can run code in a sandbox. Use it to compute, analyse data or test snippets, and report the results and code in your answer. " +
    "The sandbox has no internet and cannot reach the user's systems; files you create there are not delivered, so include anything important inline.",
  costNote:
    "Tokens, plus sandbox time: free when used alongside web search/fetch, otherwise $0.05 per container-hour after 1,550 free hours/month per organization (not tracked by Agentopia).",
  verificationCheck: "code_execution",
};
