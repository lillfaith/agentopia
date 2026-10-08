/**
 * npm run verify:live — prove the Claude integration works on THIS installation.
 *
 * Makes real, small API calls (default cap: $0.50 total) and an end-to-end agent
 * task through the real queue/executor on a throwaway database. Results and
 * their cost are recorded in your town's database, so Settings shows when each
 * capability was last verified and the treasury counts the spend.
 *
 * Options:
 *   --model <id>        model to verify (default: AGENTOPIA_DEFAULT_MODEL)
 *   --max-usd <n>       stop starting new checks once this is spent (default 0.50)
 *   --checks a,b        subset of: messages,client_tools,web_search,web_fetch,code_execution
 *   --skip-agent-task   skip the end-to-end agent task
 *   --no-record         don't write results to the town database
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../server/config.js";
import { createApp } from "../server/app.js";
import { openDatabase } from "../server/db/database.js";
import { Store } from "../server/db/store.js";
import { AnthropicProvider } from "../server/llm/anthropic.js";
import { CHECK_IDS, runVerification, type CheckId, type CheckResult } from "../server/engine/verify.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const config = loadConfig();
if (!config.anthropicApiKey) {
  console.error("✗ ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY_FILE) is not set. Nothing was called.");
  process.exit(2);
}
const model = opt("model") ?? config.defaultModel;
const maxUsd = Number(opt("max-usd") ?? 0.5);
const checks = (opt("checks")?.split(",") ?? [...CHECK_IDS]) as CheckId[];
for (const c of checks) if (!CHECK_IDS.includes(c)) throw new Error(`Unknown check ${c}`);

const provider = new AnthropicProvider(config.anthropicApiKey, config.refusalFallback);
const record = !flag("no-record");
const store = record ? new Store(openDatabase(config.dbPath)) : null;

interface Row {
  checkId: string;
  ok: boolean;
  detail: string;
  requestId: string | null;
  model: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}
const rows: Row[] = [];

function save(r: Row) {
  rows.push(r);
  const icon = r.ok ? "✓" : "✗";
  console.log(`${icon} ${r.checkId.padEnd(15)} ${r.ok ? "PASS" : "FAIL"}  ${r.detail}`);
  console.log(`  ${"".padEnd(15)} request ${r.requestId ?? "—"} · ${r.model ?? model} · ~$${r.costUsd.toFixed(4)} · ${(r.durationMs / 1000).toFixed(1)}s`);
  if (!store) return;
  store.addVerification({ checkId: r.checkId, ok: r.ok, detail: r.detail, requestId: r.requestId, model: r.model, costUsd: r.costUsd, source: "verify-live" });
  if (r.requestId) {
    store.recordUsage({
      agentId: "system", taskId: null, model: r.model ?? model, inputTokens: r.inputTokens, outputTokens: r.outputTokens,
      cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0, webFetchRequests: 0, codeExecutions: 0,
      costUsd: r.costUsd, simulated: false, requestId: r.requestId, requestedModel: model,
    });
  }
}

async function agentTask(): Promise<Row> {
  const started = Date.now();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentopia-verify-"));
  const app = createApp({ ...config, dbPath: path.join(dir, "verify.sqlite"), role: "all", maxOutputTokens: 4096, dailyBudgetUsd: maxUsd, monthlyBudgetUsd: maxUsd, maxTaskCostUsd: maxUsd }, { provider, startWorker: false });
  try {
    app.store.updateAgent("manager", { model, effort: "low" });
    const task = app.store.createTask({
      agentId: "manager",
      title: "Verification: one-line tagline",
      instructions: "Write a single playful one-line tagline for a lavender oat-milk latte. Reply with the tagline only.",
      createdBy: "user",
    });
    await app.runner.drain(180_000);
    const t = app.store.getTask(task.id)!;
    const ok = t.status === "completed" && t.execution.mode === "live" && !!t.execution.lastRequestId && !!t.output?.trim();
    return {
      checkId: "agent_task",
      ok,
      detail: ok ? `Agent task completed through the real queue: “${t.output!.trim().slice(0, 80)}”` : `Task ${t.status}: ${t.lastError ?? "no live execution recorded"}`,
      requestId: t.execution.lastRequestId,
      model: t.execution.models[0] ?? model,
      costUsd: t.execution.costUsd,
      inputTokens: t.execution.inputTokens,
      outputTokens: t.execution.outputTokens,
      durationMs: Date.now() - started,
    };
  } finally {
    await app.runner.stop();
    app.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\nAgentopia live verification — model ${model}, cap ~$${maxUsd.toFixed(2)}${record ? "" : " (not recording)"}\n`);
const results: CheckResult[] = await runVerification(provider, { model, maxTotalUsd: maxUsd, checks, onResult: (r) => save(r) });
const spent = results.reduce((a, r) => a + r.costUsd, 0);
if (!flag("skip-agent-task")) {
  if (spent >= maxUsd) save({ checkId: "agent_task", ok: false, detail: "Skipped: verification budget reached", requestId: null, model, costUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 });
  else save(await agentTask());
}
const total = rows.reduce((a, r) => a + r.costUsd, 0);
const failed = rows.filter((r) => !r.ok);
console.log(`\n${failed.length ? "✗" : "✓"} ${rows.length - failed.length}/${rows.length} checks passed · estimated cost ~$${total.toFixed(4)}`);
if (store) store.db.close();
process.exit(failed.length ? 1 : 0);
