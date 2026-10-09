/**
 * npm run cost:probe — run ONE research task through the real executor and the real
 * Claude API, and report exactly where its tokens and dollars went.
 *
 * It records every HTTP request the Anthropic SDK makes (request shape) and the raw
 * `usage` object of every response (incl. per-iteration server-tool-loop usage), then
 * prints a JSON report. The same script runs against older checkouts of the engine,
 * so it only uses APIs that existed before the cost work (Store, AgentExecutor,
 * AnthropicProvider) and reads optional newer ones defensively.
 *
 *   --model <id>      model for the researcher (default claude-sonnet-5-5)
 *   --label <name>    label in the report (default "probe")
 *   --depth <d>       research depth, when this build supports it (quick|standard|deep)
 *   --out <file>      also write the JSON report here
 *   --max-usd <n>     per-task cap for the run (default 1)
 *   (env AGENTOPIA_WEB_TOOLS=basic uses the plain web tools, on builds that support it)
 *
 * Never prints the API key.
 */
import fs from "node:fs";
import { loadConfig } from "../server/config.js";
import { openDatabase } from "../server/db/database.js";
import { Store } from "../server/db/store.js";
import { seedTown } from "../server/agents/seed.js";
import { AgentExecutor } from "../server/engine/executor.js";
import { AnthropicProvider } from "../server/llm/anthropic.js";
import { PROBE_TASK } from "./cost-probe-task.js";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const MODEL = opt("model") ?? "claude-sonnet-5-5";
const LABEL = opt("label") ?? "probe";
const DEPTH = opt("depth");
const OUT = opt("out");


const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) {
  console.error("✗ ANTHROPIC_API_KEY is not set. Nothing was called.");
  process.exit(2);
}

interface CallRecord {
  request: {
    model: string;
    maxTokens: number;
    effort: string | null;
    bodyChars: number;
    systemChars: number;
    messages: number;
    messagesChars: number;
    tools: string[];
    topLevelCache: boolean;
    cacheMarkers: number;
  };
  usage: Record<string, unknown> | null;
  requestId: string | null;
  ms: number;
}
const calls: CallRecord[] = [];
const pending: Promise<void>[] = [];

/** Count cache_control markers anywhere in the request body. */
const countMarkers = (body: string) => (body.match(/"cache_control"/g) ?? []).length;

/** fetch wrapper: snapshot the request, tee the SSE response and keep its final usage. */
const recordingFetch: typeof fetch = async (input, init) => {
  const started = Date.now();
  const body = typeof init?.body === "string" ? init.body : "";
  let parsed: any = {};
  try {
    parsed = JSON.parse(body);
  } catch {
    /* not JSON */
  }
  const res = await fetch(input, init);
  if (!String(typeof input === "string" ? input : (input as Request).url ?? input).includes("/v1/messages")) return res;
  const rec: CallRecord = {
    request: {
      model: parsed.model,
      maxTokens: parsed.max_tokens,
      effort: parsed.output_config?.effort ?? null,
      bodyChars: body.length,
      systemChars: JSON.stringify(parsed.system ?? "").length,
      messages: parsed.messages?.length ?? 0,
      messagesChars: JSON.stringify(parsed.messages ?? []).length,
      tools: (parsed.tools ?? []).map((t: any) => (t.type ? `${t.type}${t.max_uses ? ` max_uses=${t.max_uses}` : ""}${t.max_content_tokens ? ` max_content_tokens=${t.max_content_tokens}` : ""}` : `custom:${t.name}`)),
      topLevelCache: !!parsed.cache_control,
      cacheMarkers: countMarkers(body),
    },
    usage: null,
    requestId: res.headers.get("request-id"),
    ms: 0,
  };
  calls.push(rec);
  const copy = res.clone();
  pending.push(
    (async () => {
      const text = await copy.text();
      let usage: Record<string, unknown> = {};
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "message_start") usage = { ...usage, ...ev.message.usage };
          if (ev.type === "message_delta" && ev.usage) {
            for (const [k, v] of Object.entries(ev.usage)) if (v !== null && v !== undefined) usage[k] = v;
          }
        } catch {
          /* ignore partial lines */
        }
      }
      rec.usage = usage;
      rec.ms = Date.now() - started;
    })(),
  );
  return res;
};

const config = loadConfig({
  ...process.env,
  AGENTOPIA_MODE: "local",
  AGENTOPIA_SIMULATION: "false",
  AGENTOPIA_DEFAULT_MODEL: MODEL,
  AGENTOPIA_MAX_TASK_COST_USD: opt("max-usd") ?? "1",
  AGENTOPIA_DAILY_BUDGET_USD: "5",
  AGENTOPIA_MONTHLY_BUDGET_USD: "20",
  HOST: "127.0.0.1",
} as NodeJS.ProcessEnv);

const store = new Store(openDatabase(":memory:"));
seedTown(store, MODEL);
const agent = store.getAgent("researcher")!;
// Older builds ignore the 4th argument (web tool mode).
const ProviderCtor = AnthropicProvider as unknown as new (...a: unknown[]) => AnthropicProvider;
const provider = new ProviderCtor(apiKey, config.refusalFallback, { fetch: recordingFetch }, { webToolMode: process.env.AGENTOPIA_WEB_TOOLS === "basic" ? "basic" : "auto" });
const executor = new AgentExecutor(store, provider, config);

const task = store.createTask({
  ...PROBE_TASK,
  agentId: agent.id,
  createdBy: "user",
  ...(DEPTH ? { depth: DEPTH } : {}),
} as never);

const t0 = Date.now();
const outcome = await executor.execute(store.getTask(task.id)!, new AbortController().signal);
await Promise.all(pending);
const seconds = (Date.now() - t0) / 1000;

// ── what the stored transcript holds ──
const convo = store.getConversation<{ messages: { role: string; content: unknown }[] }>(task.id);
const blockChars: Record<string, number> = {};
const queries: string[] = [];
const urls: string[] = [];
for (const m of convo?.messages ?? []) {
  const blocks = typeof m.content === "string" ? [{ type: `${m.role}_text`, text: m.content }] : (m.content as any[]);
  for (const b of blocks) {
    blockChars[b.type] = (blockChars[b.type] ?? 0) + JSON.stringify(b).length;
    if (b.type === "server_tool_use" && b.name === "web_search" && b.input?.query) queries.push(b.input.query);
    if (b.type === "server_tool_use" && b.name === "web_fetch" && b.input?.url) urls.push(b.input.url);
  }
}
const dupes = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);

/** One line per hosted-tool step: who called it, what it asked, and what came back. */
const toolSteps: string[] = [];
for (const m of convo?.messages ?? []) {
  if (typeof m.content === "string") continue;
  for (const b of m.content as any[]) {
    const caller = b.caller?.type ? ` via ${b.caller.type}` : "";
    if (b.type === "server_tool_use") toolSteps.push(`call ${b.name}${caller}: ${JSON.stringify(b.input).slice(0, 160)}`);
    else if (b.type?.endsWith("_tool_result")) {
      const c = b.content;
      const err = c?.error_code ?? (Array.isArray(c) ? null : c?.content?.error_code);
      const detail = err
        ? `ERROR ${err}`
        : Array.isArray(c)
          ? `${c.length} items, ${JSON.stringify(c).length} chars`
          : `${c?.type ?? "?"}, ${JSON.stringify(c ?? "").length} chars${c?.url ? ` ${c.url}` : ""}`;
      toolSteps.push(`  → ${b.type}${caller}: ${detail}`);
    }
  }
}

const db = (store as unknown as { db: { prepare(s: string): { all(...a: unknown[]): unknown[] } } }).db;
const usageRows = db.prepare("SELECT * FROM usage WHERE task_id = ? ORDER BY id").all(task.id) as Record<string, number | string>[];
const sum = (k: string) => usageRows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
const iterations = calls.flatMap((c) => ((c.usage?.iterations as any[]) ?? []).filter((it) => it.type === "message"));
const thinking = calls.reduce((s, c) => s + Number((c.usage?.output_tokens_details as any)?.thinking_tokens ?? 0), 0);
const output = outcome.kind === "completed" ? outcome.output : "";

const report = {
  label: LABEL,
  model: MODEL,
  depth: DEPTH ?? null,
  effort: agent.effort,
  outcome: outcome.kind,
  error: outcome.kind === "failed" ? outcome.error : null,
  seconds,
  apiCalls: calls.length,
  serverIterations: iterations.length,
  tokens: {
    freshInput: sum("input_tokens"),
    cacheRead: sum("cache_read_tokens"),
    cacheWrite: sum("cache_write_tokens"),
    output: sum("output_tokens"),
    thinking,
    topbarTotal: sum("input_tokens") + sum("cache_read_tokens") + sum("cache_write_tokens") + sum("output_tokens"),
  },
  webSearches: sum("web_search_requests"),
  webFetches: sum("web_fetch_requests"),
  estimatedCostUsd: Math.round(sum("cost_usd") * 1e6) / 1e6,
  searchQueries: queries,
  fetchedUrls: urls,
  duplicateQueries: dupes(queries),
  duplicateUrls: dupes(urls),
  transcriptCharsByBlock: blockChars,
  toolSteps,
  outputChars: output.length,
  outputLinks: (output.match(/\]\(https?:\/\//g) ?? []).length,
  calls,
  usageRows,
  output,
};

console.log("\n--- output ---\n" + output);
console.log("\n--- usage rows (as stored for the treasury) ---");
for (const r of usageRows) console.log(JSON.stringify(r));
console.log("\n--- per API call ---");
for (const c of calls) console.log(JSON.stringify(c));
console.log("\n--- hosted tool steps ---\n" + toolSteps.join("\n"));
console.log(`\n=== ${LABEL} (${MODEL}${DEPTH ? `, ${DEPTH}` : ""}) — ${outcome.kind} in ${seconds.toFixed(0)}s ===`);
console.log(JSON.stringify({ ...report, output: undefined, calls: undefined, usageRows: undefined, toolSteps: undefined }, null, 2));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
process.exit(outcome.kind === "completed" ? 0 : 1);
