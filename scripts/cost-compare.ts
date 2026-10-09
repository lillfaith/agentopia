/**
 * Compare cost-probe reports side by side and grade each answer's quality.
 *
 *   tsx scripts/cost-compare.ts probe-*.json
 *
 * Quality is graded blind by Claude Opus 5.5 against a fixed rubric (one request per
 * answer; the grader never sees the label, model or cost). Prints a Markdown table and
 * appends it to $GITHUB_STEP_SUMMARY when set. Never prints the API key.
 */
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { PROBE_TASK } from "./cost-probe-task.js";

interface Report {
  label: string;
  model: string;
  depth: string | null;
  outcome: string;
  seconds: number;
  apiCalls: number;
  serverIterations: number;
  tokens: { freshInput: number; cacheRead: number; cacheWrite: number; output: number; thinking: number; topbarTotal: number };
  webSearches: number;
  webFetches: number;
  estimatedCostUsd: number;
  duplicateQueries: string[];
  duplicateUrls: string[];
  outputLinks: number;
  output: string;
  cacheCheck?: { freshInput: number; cacheRead: number; cacheWrite: number; output: number; costUsd: number } | null;
}

const files = process.argv.slice(2).filter((f) => f.endsWith(".json"));
const reports: Report[] = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8"))).sort((a, b) => a.label.localeCompare(b.label));

const RUBRIC = `You are grading a market-research brief written for a small marketing team.

The request was:
"""${PROBE_TASK.instructions}"""

Score each criterion from 0 to 10:
- coverage: does it deliver all four asks (5 leading brands with per-bar prices, audiences, last-12-month trends, 3 marketing angles)?
- evidence: are facts tied to specific, checkable sources (links), with prices and dates where it matters?
- reliability: does it separate verified facts from assumptions and flag uncertainty honestly, without padding?
- usefulness: could a copywriter act on it directly?

Reply with ONLY a JSON object: {"coverage":n,"evidence":n,"reliability":n,"usefulness":n,"overall":n,"note":"one sentence"}.
"overall" is your holistic 0-10 score, not an average.`;

async function grade(client: Anthropic, output: string) {
  if (!output.trim()) return null;
  const msg = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    messages: [{ role: "user", content: `${RUBRIC}\n\n<brief>\n${output}\n</brief>` }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  return json ? (JSON.parse(json) as { coverage: number; evidence: number; reliability: number; usefulness: number; overall: number; note: string }) : null;
}

const key = process.env.ANTHROPIC_API_KEY?.trim();
const client = key ? new Anthropic({ apiKey: key }) : null;
const grades = await Promise.all(reports.map((r) => (client ? grade(client, r.output).catch((e) => ({ error: String(e) })) : null)));

const usd = (n: number) => `$${n.toFixed(4)}`;
const k = (n: number) => n.toLocaleString("en-US");
const rows = reports.map((r, i) => {
  const g = grades[i] as any;
  return [
    r.label,
    r.model.replace("claude-", ""),
    r.depth ?? "—",
    r.outcome,
    usd(r.estimatedCostUsd),
    String(r.apiCalls),
    String(r.serverIterations),
    k(r.tokens.freshInput),
    k(r.tokens.cacheRead),
    k(r.tokens.cacheWrite),
    k(r.tokens.output),
    k(r.tokens.thinking),
    k(r.tokens.topbarTotal),
    String(r.webSearches),
    String(r.webFetches),
    String(r.duplicateQueries.length + r.duplicateUrls.length),
    String(r.outputLinks),
    g?.overall !== undefined ? `${g.overall}/10 (cov ${g.coverage}, evid ${g.evidence}, rel ${g.reliability}, use ${g.usefulness})` : g?.error ? "grading failed" : "—",
    `${r.seconds.toFixed(0)}s`,
  ];
});
const cc = (r: Report) => (r.cacheCheck ? `${k(r.cacheCheck.freshInput)} fresh / ${k(r.cacheCheck.cacheRead)} cached · ${usd(r.cacheCheck.costUsd)}` : "—");
rows.forEach((row, i) => row.push(cc(reports[i])));
const header = ["run", "model", "depth", "outcome", "cost", "calls", "iterations", "fresh in", "cache read", "cache write", "output", "thinking", "all tokens", "searches", "fetches", "dupes", "links", "quality", "time", "next call (cache check)"];
const table = [header, header.map(() => "---"), ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");
const notes = reports
  .map((r, i) => {
    const g = grades[i] as any;
    return g?.note ? `- **${r.label}**: ${g.note}` : null;
  })
  .filter(Boolean)
  .join("\n");
// Averages per variant (labels ending in -a, -b, -c are repeats of one variant).
const groups = new Map<string, number[]>();
reports.forEach((r, i) => {
  const key = r.label.replace(/-[a-z]$/, "");
  groups.set(key, [...(groups.get(key) ?? []), i]);
});
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const range = (xs: number[], f: (n: number) => string) => (xs.length > 1 ? ` (${f(Math.min(...xs))}–${f(Math.max(...xs))})` : "");
const gHeader = ["variant", "runs", "avg cost", "avg calls", "avg all tokens", "avg cache read", "avg output", "avg searches", "avg links", "avg quality", "avg next-call cost"];
const gRows = [...groups].map(([key, idx]) => {
  const rs = idx.map((i) => reports[i]);
  const q = idx.map((i) => (grades[i] as any)?.overall).filter((x): x is number => typeof x === "number");
  const costs = rs.map((r) => r.estimatedCostUsd);
  const checks = rs.map((r) => r.cacheCheck?.costUsd).filter((x): x is number => typeof x === "number");
  return [
    key,
    String(rs.length),
    usd(mean(costs)) + range(costs, usd),
    mean(rs.map((r) => r.apiCalls)).toFixed(1),
    k(Math.round(mean(rs.map((r) => r.tokens.topbarTotal)))),
    k(Math.round(mean(rs.map((r) => r.tokens.cacheRead)))),
    k(Math.round(mean(rs.map((r) => r.tokens.output)))),
    mean(rs.map((r) => r.webSearches)).toFixed(1),
    mean(rs.map((r) => r.outputLinks)).toFixed(0),
    q.length ? `${mean(q).toFixed(1)}/10` + range(q, (x) => String(x)) : "—",
    checks.length ? usd(mean(checks)) : "—",
  ];
});
const gTable = [gHeader, gHeader.map(() => "---"), ...gRows].map((r) => `| ${r.join(" | ")} |`).join("\n");
const out = `## Cost probe comparison\n\n### By variant\n\n${gTable}\n\n### Every run\n\n${table}\n\n### Grader notes\n${notes || "(no grades)"}\n`;
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out);
