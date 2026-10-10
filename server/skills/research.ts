import { webFetch, webSearch } from "../agents/tools.js";
import type { SkillDefinition } from "./types.js";

export const research: SkillDefinition = {
  id: "research",
  label: "Web research",
  shortLabel: "Research",
  providerNote: "Claude uses hosted web search and page reading, OpenAI its web search, Gemini Google Search. Some older models can't search; the employee then says so and works from what it knows.",
  icon: "🔭",
  category: "research",
  description: "Search the web and read pages for current, citable facts (Claude's hosted web search + web fetch).",
  status: "available",
  tools: [webSearch, webFetch],
  prompt:
    "Research skill: answer well-established knowledge from what you already know, and use web search for what is recent, niche, " +
    "disputed, numeric, or needs a citation. Plan your searches first, don't repeat a search, and fetch a page only when a result's " +
    "snippet isn't enough. If the request asks for sources, links or citations, verify each key claim with a search and link " +
    "the page you found (never a link from memory); otherwise cite the key claims inline as Markdown links where you can " +
    "(one or two good sources beat many weak ones), " +
    "and separate verified facts from your own background knowledge and assumptions.",
  costNote:
    "Web search: $10 per 1,000 searches plus tokens for results. Web fetch: no extra fee beyond the tokens it adds. " +
    "Each task's research depth (Quick / Standard / Deep) caps searches, page reads, page size and spend.",
  verificationCheck: "web_search",
};
