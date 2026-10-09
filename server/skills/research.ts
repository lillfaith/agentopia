import { webFetch, webSearch } from "../agents/tools.js";
import type { SkillDefinition } from "./types.js";

export const research: SkillDefinition = {
  id: "research",
  label: "Web research",
  icon: "🔭",
  category: "research",
  description: "Search the web and read pages for current, citable facts (Claude's hosted web search + web fetch).",
  status: "available",
  tools: [webSearch, webFetch],
  prompt:
    "Research skill: use web search for anything time-sensitive or factual, fetch the most relevant pages to read them properly, " +
    "and cite sources inline as Markdown links. Separate verified facts from assumptions.",
  costNote:
    "Web search: $10 per 1,000 searches plus tokens for results. Web fetch: no extra fee beyond the tokens it adds. " +
    "Each task's research depth (Quick / Standard / Deep) caps searches, page reads, page size and spend.",
  verificationCheck: "web_search",
};
