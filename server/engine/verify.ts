import { createHash } from "node:crypto";
import type { Effort } from "../../shared/types.js";
import { estimateCostUsd } from "../llm/models.js";
import type { GenerateRequest, GenerateResult, LLMProvider } from "../llm/provider.js";

/**
 * Live verification checks. Each check makes a REAL request through the same
 * provider code the agents use and passes only on concrete evidence: an API
 * request id plus the expected tool activity or a result we can check locally.
 * Nothing here is mocked; tests exercise this file with a fake provider only to
 * check the pass/fail logic.
 */

export const CHECK_IDS = ["messages", "client_tools", "web_search", "web_fetch", "code_execution"] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export interface CheckResult {
  checkId: CheckId;
  ok: boolean;
  detail: string;
  requestId: string | null;
  model: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface VerifyOptions {
  model: string;
  effort?: Effort;
  maxTokens?: number;
  /** Stop before a check if the running total would pass this (estimated). */
  maxTotalUsd?: number;
  checks?: CheckId[];
  onResult?: (r: CheckResult) => void;
}

const SYSTEM = "You are a verification probe for the Agentopia app. Follow the instruction exactly and keep answers very short.";

export async function runVerification(provider: LLMProvider, opts: VerifyOptions): Promise<CheckResult[]> {
  if (provider.simulated) throw new Error("Live verification needs a real provider (the simulator never calls an API).");
  const checks = opts.checks ?? [...CHECK_IDS];
  const results: CheckResult[] = [];
  let spent = 0;
  for (const id of checks) {
    if (opts.maxTotalUsd !== undefined && spent >= opts.maxTotalUsd) {
      const r: CheckResult = { checkId: id, ok: false, detail: `Skipped: verification budget of $${opts.maxTotalUsd.toFixed(2)} reached`, requestId: null, model: null, costUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 };
      results.push(r);
      opts.onResult?.(r);
      continue;
    }
    const started = Date.now();
    let r: CheckResult;
    try {
      r = await CHECKS[id](provider, opts);
    } catch (err) {
      r = { checkId: id, ok: false, detail: `Error: ${err instanceof Error ? err.message : String(err)}`, requestId: null, model: opts.model, costUsd: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 };
    }
    r.durationMs = Date.now() - started;
    spent += r.costUsd;
    results.push(r);
    opts.onResult?.(r);
  }
  return results;
}

function req(opts: VerifyOptions, prompt: unknown[], extra: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    model: opts.model,
    effort: opts.effort ?? "low",
    system: SYSTEM,
    messages: prompt,
    tools: [],
    hostedTools: [],
    maxTokens: opts.maxTokens ?? 4096,
    ...extra,
  };
}

const cost = (r: GenerateResult) => estimateCostUsd(r.servedModel, r.usage);

function base(id: CheckId, r: GenerateResult, ok: boolean, detail: string): CheckResult {
  return {
    checkId: id,
    ok: ok && !!r.requestId,
    detail: r.requestId ? detail : `${detail} (no request id returned)`,
    requestId: r.requestId,
    model: r.servedModel,
    costUsd: cost(r),
    inputTokens: r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens,
    outputTokens: r.usage.outputTokens,
    durationMs: 0,
  };
}

const CHECKS: Record<CheckId, (p: LLMProvider, o: VerifyOptions) => Promise<CheckResult>> = {
  /** Basic Messages API round trip with streaming, effort and the configured model. */
  async messages(p, o) {
    const r = await p.generate(req(o, [p.userMessage("Reply with exactly the word: AGENTOPIA-OK")]));
    const ok = r.stopReason === "end_turn" && r.text.includes("AGENTOPIA-OK");
    return base("messages", r, ok, ok ? `Model replied (${r.usage.inputTokens} in / ${r.usage.outputTokens} out tokens)` : `Unexpected reply (${r.stopReason}): ${r.text.slice(0, 120)}`);
  },

  /** Client tool loop: the model must call our tool, then use its result. */
  async client_tools(p, o) {
    const secret = String(Math.floor(100000 + Math.random() * 900000));
    const tool = {
      name: "get_secret_number",
      description: "Returns the secret verification number. Call it when asked for the secret number.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    };
    const first = await p.generate(req(o, [p.userMessage("Call get_secret_number, then reply with only the number it returns.")], { tools: [tool] }));
    const call = first.toolCalls.find((c) => c.name === "get_secret_number");
    if (!call) return base("client_tools", first, false, `Model did not call the tool (stop: ${first.stopReason})`);
    const second = await p.generate(
      req(o, [p.userMessage("Call get_secret_number, then reply with only the number it returns."), first.assistantMessage, p.toolResultsMessage([{ toolCallId: call.id, content: secret }])], {
        tools: [tool],
      }),
    );
    const ok = second.text.includes(secret);
    const r = base("client_tools", second, ok, ok ? "Tool called and its result used" : `Final answer did not contain the tool result: ${second.text.slice(0, 120)}`);
    r.costUsd += cost(first);
    r.inputTokens += first.usage.inputTokens + first.usage.cacheReadTokens + first.usage.cacheWriteTokens;
    r.outputTokens += first.usage.outputTokens;
    return r;
  },

  /** Hosted web search must actually run (usage reports ≥1 search). */
  async web_search(p, o) {
    const r = await p.generate(
      req(o, [p.userMessage("Use web search once to find the official website of the Python programming language. Reply with only that URL.")], { hostedTools: ["web_search"] }),
    );
    const ok = r.usage.webSearchRequests > 0 && /python\.org/i.test(r.text);
    return base("web_search", r, ok, ok ? `${r.usage.webSearchRequests} search(es) run; answer cites python.org` : `Searches: ${r.usage.webSearchRequests}; answer: ${r.text.slice(0, 120)}`);
  },

  /** Hosted web fetch must read a known page. */
  async web_fetch(p, o) {
    const r = await p.generate(req(o, [p.userMessage("Fetch https://example.com and reply with only the page's main heading text.")], { hostedTools: ["web_fetch"] }));
    const fetched = (r.usage.webFetchRequests ?? 0) > 0 || r.hostedActivity.some((a) => a.startsWith("Read page"));
    const ok = fetched && /example domain/i.test(r.text);
    return base("web_fetch", r, ok, ok ? "Page fetched; heading “Example Domain” reported" : `Fetched: ${fetched}; answer: ${r.text.slice(0, 120)}`);
  },

  /** Hosted code execution must compute a value we verify locally. */
  async code_execution(p, o) {
    const word = `agentopia-${Math.floor(Math.random() * 1e6)}`;
    const expected = createHash("sha256").update(word).digest("hex");
    const r = await p.generate(
      req(o, [p.userMessage(`Use the code execution tool to compute the SHA-256 hex digest of the exact string "${word}" (no newline). Reply with only the 64-character hex digest.`)], {
        hostedTools: ["code_execution"],
      }),
    );
    const ran = (r.usage.codeExecutions ?? 0) > 0;
    const ok = ran && r.text.toLowerCase().includes(expected);
    return base("code_execution", r, ok, ok ? "Code ran in the sandbox; digest matches local computation" : `Ran code: ${ran}; digest match: ${r.text.toLowerCase().includes(expected)}`);
  },
};
