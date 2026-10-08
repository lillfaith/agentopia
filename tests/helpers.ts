import { loadConfig, type Config } from "../server/config.js";
import { createApp } from "../server/app.js";
import type { GenerateRequest, GenerateResult, LLMProvider, ToolResult } from "../server/llm/provider.js";

export function testConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({ HOST: "127.0.0.1", AGENTOPIA_DB_PATH: ":memory:" } as NodeJS.ProcessEnv);
  return { ...base, dbPath: ":memory:", anthropicApiKey: null, simulation: false, workerPollMs: 10_000, ...overrides };
}

export function harness(provider: LLMProvider, overrides: Partial<Config> = {}) {
  const config = testConfig(overrides);
  const app = createApp(config, { provider, startWorker: false, timings: { retryBaseMs: 1, statusDecayMs: 5 } });
  const request = (path: string, init: RequestInit = {}) =>
    app.api.request(path, {
      ...init,
      headers: { host: "127.0.0.1:8787", "content-type": "application/json", ...(init.headers ?? {}) },
    });
  return { ...app, config, request };
}

type Step = (req: GenerateRequest) => Partial<GenerateResult> | Error;

/** Deterministic fake provider: each generate() call consumes the next scripted step. */
export class ScriptedProvider implements LLMProvider {
  readonly id = "scripted";
  calls: GenerateRequest[] = [];
  constructor(
    private readonly steps: Step[],
    readonly simulated = false,
  ) {}
  userMessage(text: string) {
    return { role: "user", content: text };
  }
  toolResultsMessage(results: ToolResult[]) {
    return { role: "user", content: results };
  }
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.calls.push(structuredClone({ ...req, signal: undefined }));
    const step = this.steps.shift();
    if (!step) throw new Error("ScriptedProvider ran out of steps");
    const out = step(req);
    if (out instanceof Error) throw out;
    const text = out.text ?? "";
    return {
      assistantMessage: { role: "assistant", content: text || out.toolCalls },
      text,
      toolCalls: [],
      stopReason: "end_turn",
      usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 },
      servedModel: req.model,
      fallbackUsed: false,
      refusal: null,
      hostedActivity: [],
      ...out,
    };
  }
}

export const say = (text: string): Step => () => ({ text });
export const callTool = (name: string, input: unknown, id = `tu_${name}`): Step => () => ({
  toolCalls: [{ id, name, input }],
  stopReason: "tool_use",
});
