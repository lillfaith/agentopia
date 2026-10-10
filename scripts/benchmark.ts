/**
 * npm run benchmark — before/after comparison of the token-efficiency changes on the REAL API.
 *
 * Five representative task types (simple writing, basic research, multi-source research, coding,
 * a delegated two-employee workflow), each run in a fresh throwaway in-memory town through the
 * real task engine, under three variants:
 *   before          Sonnet employees, the old research prompt and Standard at 6 searches / 4 reads
 *   after-balanced  the new defaults (knowledge-first research, Standard 4 / 3, Balanced model choice)
 *   after-economy   the same, with the town's model choice set to Economy (opt-in)
 * Non-research tasks are unaffected by the research changes, so they run "before = balanced" once.
 *
 * Every answer is graded blind (Claude Sonnet 5.5, fixed rubric per task, label and cost hidden).
 * Spend is hard-capped: --budget (default 1.50) covers the runs AND the grading. A run only starts
 * when its worst case still fits, and the engine's own budget preflight enforces the remainder.
 * Prints a Markdown report (also to $GITHUB_STEP_SUMMARY) and writes benchmark.json. Never prints
 * the API key.
 */
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "../server/config.js";
import { createApp } from "../server/app.js";
import { DEPTHS } from "../server/engine/depth.js";
import { research } from "../server/skills/research.js";
import { estimateCostUsd } from "../server/llm/models.js";
import type { ModelPreference } from "../shared/types.js";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const BUDGET = Number(opt("budget", "1.50"));
const PER_RUN_CAP = 0.3; // also the engine's per-task ceiling for every run
const GRADER = "claude-sonnet-5-5";

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) {
  console.error("✗ ANTHROPIC_API_KEY is not set. Nothing was called.");
  process.exit(2);
}

type Variant = "before" | "after-balanced" | "after-economy" | "sonnet (before = balanced)";
interface Case {
  id: string;
  label: string;
  agent: "copywriter" | "researcher" | "engineer" | "manager";
  skills: string[];
  title: string;
  instructions: string;
  depth?: "standard";
  research: boolean;
  rubric: string;
}

const CASES: Case[] = [
  {
    id: "writing",
    label: "Simple writing",
    agent: "copywriter",
    skills: ["writing"],
    title: "Candle product description",
    instructions: "Write a 100–130 word product description for a lavender soy candle (burn time 45 hours, cotton wick, hand-poured in small batches). Friendly, no hype.",
    research: false,
    rubric: "Does it meet the length, include the given facts without inventing new ones, and read warmly without hype?",
  },
  {
    id: "basic-research",
    label: "Basic research",
    agent: "researcher",
    skills: ["research", "writing", "memory"],
    title: "Misunderstood historical events",
    instructions: "What are the top three most misunderstood historical events? For each, give the common belief, what actually happened, and a source.",
    depth: "standard",
    research: true,
    rubric: "Are the three events well chosen and the corrections historically accurate? Is each backed by a credible source? Penalise factual errors heavily.",
  },
  {
    id: "multi-source",
    label: "Multi-source research",
    agent: "researcher",
    skills: ["research", "writing", "memory"],
    title: "Project tool pricing",
    instructions: "Compare the current monthly price for a 10-person team on Asana, Trello and Notion (cheapest paid plan each), with a source link for every price and the date you checked.",
    depth: "standard",
    research: true,
    rubric: "Are current prices given for all three with a source link each? Are they plausible and clearly dated? Penalise missing sources or invented prices heavily.",
  },
  {
    id: "coding",
    label: "Coding",
    agent: "engineer",
    skills: ["coding", "writing"],
    title: "ISO 8601 duration parser",
    instructions: "Write a Python function parse_duration(s) that converts ISO 8601 durations like 'PT1H30M' or 'P1DT2H' into seconds, with a few assert-based tests. Run the tests and report the result.",
    research: false,
    rubric: "Is the code correct for days, hours, minutes and seconds, with sensible tests that were actually run? Penalise bugs heavily.",
  },
  {
    id: "delegation",
    label: "Delegated workflow",
    agent: "manager",
    skills: ["writing", "delegation"],
    title: "Taglines via the Copywriter",
    instructions: "Have the Copywriter (agent id copywriter) write three tagline options for 'Wick & Wax', a small candle shop. Give them a clear brief. Then reply with the brief you sent.",
    research: false,
    rubric: "Is the brief to the copywriter clear and complete, and are the copywriter's three taglines on-brief, distinct and usable?",
  },
];

interface Run {
  case: string;
  variant: Variant;
  rep: number;
  model: string;
  status: string;
  seconds: number;
  calls: number;
  serverIterations: number;
  tokens: { fresh: number; cacheWrite: number; cacheRead: number; output: number; thinking: number; total: number };
  searches: number;
  fetches: number;
  costUsd: number;
  output: string;
  grade?: { overall: number; accuracy: number; note: string } | null;
}

let spent = 0;
const runs: Run[] = [];
const OLD_PROMPT =
  "Research skill: use web search for anything time-sensitive or factual, fetch the most relevant pages to read them properly, " +
  "and cite sources inline as Markdown links. Separate verified facts from assumptions.";
const NEW_PROMPT = research.prompt;
const NEW_STANDARD = { maxSearches: DEPTHS.standard.maxSearches, maxFetches: DEPTHS.standard.maxFetches };

async function runOne(c: Case, variant: Variant, rep: number): Promise<Run | null> {
  if (spent + PER_RUN_CAP > BUDGET - 0.05) {
    console.log(`– skipped ${c.id}/${variant}#${rep}: would not fit the $${BUDGET.toFixed(2)} budget (spent $${spent.toFixed(4)})`);
    return null;
  }
  // "before" = the engine as it was: the old research prompt and Standard limits.
  const before = variant === "before";
  research.prompt = before ? OLD_PROMPT : NEW_PROMPT;
  Object.assign(DEPTHS.standard, before ? { maxSearches: 6, maxFetches: 4 } : NEW_STANDARD);
  const preference: ModelPreference = variant === "after-economy" ? "economy" : "balanced";

  const config = {
    ...loadConfig({ ...process.env, AGENTOPIA_DB_PATH: ":memory:", HOST: "127.0.0.1" } as NodeJS.ProcessEnv),
    dbPath: ":memory:",
    simulation: false,
    anthropicApiKey: apiKey!,
    dailyBudgetUsd: Math.max(0.01, BUDGET - spent),
    maxTaskCostUsd: PER_RUN_CAP,
    workerPollMs: 60_000,
  };
  const app = createApp(config, { startWorker: false });
  const s = app.store;
  s.updateSettings({ modelPreference: preference });
  if (c.agent === "engineer" && !s.getAgent("engineer")) {
    const base = s.getAgent("copywriter")!;
    s.insertAgent({
      id: "engineer", name: "Bolt", role: "Developer", personality: "Methodical and pragmatic.",
      systemPrompt: "You are a Developer at a small AI company. You write clear, correct code, test it in your sandbox, and explain how to use it.",
      responsibilities: ["Write and test code"], model: "claude-sonnet-5-5", effort: "medium", skills: c.skills, appearance: base.appearance, voice: base.voice,
      buildingId: base.buildingId, enabled: true,
    });
  }
  for (const id of ["manager", "researcher", "copywriter", "engineer"]) if (s.getAgent(id)) s.updateAgent(id, { model: "claude-sonnet-5-5" });
  s.updateAgent(c.agent, { skills: c.skills });
  if (c.id === "delegation") s.updateAgent("copywriter", { skills: ["writing"] });

  const started = Date.now();
  const task = s.createTask({ agentId: c.agent, title: c.title, instructions: c.instructions, createdBy: "user", ...(c.depth ? { depth: c.depth } : {}) });
  try {
    await app.runner.drain(300_000); // research calls can take a minute or two
  } catch (err) {
    console.error(`  run error: ${err instanceof Error ? err.message : err}`);
    for (const t of s.listTasks({ limit: 50 })) if (t.status === "running" || t.status === "queued") app.runner.cancelTask(t.id);
    await new Promise((r) => setTimeout(r, 2000));
  }
  const seconds = (Date.now() - started) / 1000;
  const rows = s.usageQuery<Record<string, number | string>>("SELECT * FROM usage WHERE simulated = 0");
  const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const cost = sum("cost_usd");
  spent += cost;
  const all = s.listTasks({ limit: 50 });
  const main = s.getTask(task.id)!;
  const children = all.filter((t) => t.id !== task.id);
  const output = [main.output ?? main.lastError ?? "", ...children.map((t) => `\n\n--- Delegated to ${t.agentId}: ${t.title} ---\n${t.output ?? t.lastError ?? `(${t.status})`}`)].join("");
  const run: Run = {
    case: c.id,
    variant,
    rep,
    model: [...new Set(rows.map((r) => String(r.model)))].join(", ") || "—",
    status: [main.status, ...children.map((t) => t.status)].join("+"),
    seconds,
    calls: rows.length,
    serverIterations: sum("server_iterations") || rows.length,
    tokens: { fresh: sum("input_tokens"), cacheWrite: sum("cache_write_tokens"), cacheRead: sum("cache_read_tokens"), output: sum("output_tokens"), thinking: sum("thinking_tokens"), total: sum("input_tokens") + sum("cache_write_tokens") + sum("cache_read_tokens") + sum("output_tokens") },
    searches: sum("web_search_requests"),
    fetches: sum("web_fetch_requests"),
    costUsd: cost,
    output,
  };
  await app.runner.stop?.();
  app.db.close();
  console.log(`✓ ${c.id}/${variant}#${rep}: ${run.status} · ${run.model} · ${run.calls} call(s) · ${run.searches} searches · ${run.tokens.total} tokens · $${cost.toFixed(4)} · ${seconds.toFixed(1)}s  (spent $${spent.toFixed(4)})`);
  return run;
}

async function grade(client: Anthropic, c: Case, output: string) {
  if (!output.trim() || spent > BUDGET - 0.02) return null;
  const prompt = `You are grading an AI employee's work. The request was:\n"""${c.instructions}"""\n\nCriteria: ${c.rubric}\n\nReply with ONLY a JSON object: {"overall": 0-10, "accuracy": 0-10, "note": "one sentence"}. "accuracy" is factual/technical correctness; "overall" is holistic usefulness.\n\n<work>\n${output.slice(0, 24_000)}\n</work>`;
  const msg = await client.messages.create({ model: GRADER, max_tokens: 400, messages: [{ role: "user", content: prompt }] });
  spent += estimateCostUsd(GRADER, { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  try {
    return json ? (JSON.parse(json) as { overall: number; accuracy: number; note: string }) : null;
  } catch {
    return null;
  }
}

const plan: [Case, Variant, number][] = [];
for (const c of CASES) {
  if (c.research) {
    plan.push([c, "before", 1], [c, "after-balanced", 1], [c, "after-economy", 1], [c, "before", 2], [c, "after-balanced", 2]);
  } else {
    plan.push([c, "sonnet (before = balanced)", 1], [c, "after-economy", 1]);
  }
}
// Cheap, informative runs first, so a tight budget still covers every case once.
plan.sort((a, b) => a[2] - b[2]);

for (const [c, v, rep] of plan) {
  const r = await runOne(c, v, rep);
  if (r) runs.push(r);
}
research.prompt = NEW_PROMPT;
Object.assign(DEPTHS.standard, NEW_STANDARD);

const client = new Anthropic({ apiKey });
const order = [...runs].sort(() => Math.random() - 0.5); // grade in random order (blind)
for (const r of order) {
  const c = CASES.find((x) => x.id === r.case)!;
  try {
    r.grade = await grade(client, c, r.output);
  } catch (err) {
    console.error(`  grading failed: ${err instanceof Error ? err.message : err}`);
  }
}

const usd = (n: number) => `$${n.toFixed(4)}`;
const lines: string[] = [`## Benchmark: before vs after (${new Date().toISOString().slice(0, 10)})`, "", `Budget $${BUDGET.toFixed(2)} · spent **${usd(spent)}** (runs + grading) · key: ${process.env.AGENTOPIA_CI_KEY_SOURCE ?? "local"}`, ""];
for (const c of CASES) {
  const rs = runs.filter((r) => r.case === c.id);
  if (!rs.length) continue;
  lines.push(`### ${c.label}`, "", "| Variant | Model | Calls (steps) | Fresh in | Cache write | Cache read | Output | Total tokens | Searches / reads | Cost | Time | Quality / accuracy |", "|---|---|---|---:|---:|---:|---:|---:|---|---:|---:|---|");
  for (const r of rs) {
    lines.push(
      `| ${r.variant}${r.rep > 1 ? ` #${r.rep}` : ""} | ${r.model} | ${r.calls} (${r.serverIterations}) | ${r.tokens.fresh} | ${r.tokens.cacheWrite} | ${r.tokens.cacheRead} | ${r.tokens.output} | ${r.tokens.total} | ${r.searches} / ${r.fetches} | ${usd(r.costUsd)} | ${r.seconds.toFixed(0)}s | ${r.grade ? `${r.grade.overall} / ${r.grade.accuracy}` : "—"} |`,
    );
  }
  lines.push("");
}
lines.push("Quality and accuracy are blind 0–10 grades by Claude Sonnet 5.5 against a fixed rubric per task. Samples are small; differences of about one point are noise. Costs are list-price estimates.");
const report = lines.join("\n");
console.log(`\n${report}`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
fs.writeFileSync("benchmark.json", JSON.stringify({ budget: BUDGET, spent, runs }, null, 2));
console.log(`\nNotes per run:\n${runs.map((r) => `- ${r.case}/${r.variant}#${r.rep}: ${r.grade?.note ?? "(not graded)"}`).join("\n")}`);
