import Anthropic from "@anthropic-ai/sdk";
import type { GenerateRequest, GenerateResult, LLMProvider, StopReason, ToolResult } from "./provider.js";
import { NonRetryableError } from "./provider.js";
import { modelSpec } from "./models.js";

type BetaParams = Anthropic.Beta.Messages.MessageCreateParamsStreaming;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaToolUnion = Anthropic.Beta.Messages.BetaToolUnion;

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Real Claude API provider. The API key is read server-side only; it is never
 * logged, persisted, or sent to the browser.
 */
export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";
  readonly simulated = false;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly refusalFallback: "default" | "off",
    clientOptions: Omit<ConstructorParameters<typeof Anthropic>[0] & object, "apiKey"> = {},
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, ...clientOptions });
  }

  userMessage(text: string): BetaMessageParam {
    return { role: "user", content: text };
  }

  toolResultsMessage(results: ToolResult[]): BetaMessageParam {
    // All results for one assistant turn go back in a single user message.
    return {
      role: "user",
      content: results.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.toolCallId,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      })),
    };
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const spec = modelSpec(req.model);
    const tools: BetaToolUnion[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
      eager_input_streaming: true,
    }));
    tools.push(...hostedToolDefinitions(req.hostedTools, spec.supportsWebSearch));

    const useFallback = this.refusalFallback === "default" && spec.supportsServerFallback;
    const params: BetaParams = {
      model: req.model,
      max_tokens: req.maxTokens,
      // Stable per-agent system prompt first so it can be served from the prompt cache.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: req.messages as BetaMessageParam[],
      output_config: { effort: req.effort },
      stream: true,
      ...(tools.length ? { tools } : {}),
      ...(useFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    };

    let message: Anthropic.Beta.Messages.BetaMessage;
    let requestId: string | null = null;
    try {
      const stream = this.client.beta.messages.stream(params, { signal: req.signal });
      message = await stream.finalMessage();
      requestId = stream.request_id ?? null;
    } catch (err) {
      throw mapError(err);
    }

    const text = message.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const toolCalls = message.content
      .filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));

    const hostedActivity: string[] = [];
    let codeExecutions = 0;
    let webFetches = 0;
    for (const b of message.content) {
      if (b.type !== "server_tool_use") continue;
      const input = (b.input ?? {}) as { query?: string; url?: string; command?: string; path?: string; code?: string };
      if (b.name === "web_search") hostedActivity.push(input.query ? `Web search: “${input.query}”` : "Web search");
      else if (b.name === "web_fetch") {
        webFetches += 1;
        hostedActivity.push(input.url ? `Read page: ${input.url}` : "Read a web page");
      } else if (b.name === "bash_code_execution" || b.name === "code_execution") {
        codeExecutions += 1;
        const cmd = (input.command ?? input.code ?? "").split("\n")[0].slice(0, 100);
        hostedActivity.push(cmd ? `Ran code: ${cmd}` : "Ran code in sandbox");
      } else if (b.name === "text_editor_code_execution") {
        codeExecutions += 1;
        hostedActivity.push(input.path ? `Edited file in sandbox: ${input.path}` : "Edited a file in the sandbox");
      }
    }

    const u = message.usage;
    return {
      assistantMessage: { role: "assistant", content: message.content } as BetaMessageParam,
      text,
      toolCalls,
      stopReason: mapStop(message.stop_reason),
      usage: {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        webSearchRequests: u.server_tool_use?.web_search_requests ?? 0,
        webFetchRequests: Math.max(webFetches, u.server_tool_use?.web_fetch_requests ?? 0),
        codeExecutions,
      },
      servedModel: message.model,
      fallbackUsed: message.content.some((b) => b.type === "fallback"),
      refusal:
        message.stop_reason === "refusal"
          ? {
              category: (message.stop_details as { category?: string } | null)?.category ?? null,
              explanation: (message.stop_details as { explanation?: string } | null)?.explanation ?? null,
            }
          : null,
      hostedActivity,
      requestId,
    };
  }
}

/**
 * Map hosted capabilities to Anthropic server-tool definitions.
 * The _20260209 web tools run their own code sandbox for dynamic filtering;
 * declaring the standalone code_execution tool alongside them creates a second
 * execution environment that can confuse the model, so when both are requested
 * we use the basic web tool versions and a single code sandbox.
 */
export function hostedToolDefinitions(hosted: string[], modelSupportsDynamicWeb: boolean): BetaToolUnion[] {
  const out: BetaToolUnion[] = [];
  const wantsCode = hosted.includes("code_execution");
  const dynamic = modelSupportsDynamicWeb && !wantsCode;
  if (hosted.includes("web_search")) {
    out.push(dynamic ? { type: "web_search_20260209", name: "web_search", max_uses: 5 } : { type: "web_search_20250305", name: "web_search", max_uses: 5 });
  }
  if (hosted.includes("web_fetch")) {
    out.push(dynamic ? { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5 } : { type: "web_fetch_20250910", name: "web_fetch", max_uses: 5 });
  }
  if (wantsCode) out.push({ type: "code_execution_20260521", name: "code_execution" });
  return out;
}

function mapStop(reason: string | null): StopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    case "tool_use":
    case "max_tokens":
    case "refusal":
    case "pause_turn":
      return reason;
    default:
      return "other";
  }
}

function mapError(err: unknown): Error {
  // Most specific first. 4xx client errors will not succeed on retry.
  if (err instanceof Anthropic.AuthenticationError) return new NonRetryableError("Claude API rejected the API key (401). Check ANTHROPIC_API_KEY.");
  if (err instanceof Anthropic.PermissionDeniedError) return new NonRetryableError(`Claude API permission denied (403): ${err.message}`);
  if (err instanceof Anthropic.NotFoundError) return new NonRetryableError(`Model or resource not found (404): ${err.message}`);
  if (err instanceof Anthropic.BadRequestError) return new NonRetryableError(`Claude API rejected the request (400): ${err.message}`);
  if (err instanceof Anthropic.RateLimitError) return new Error(`Rate limited by Claude API (429) — will retry: ${err.message}`);
  if (err instanceof Anthropic.APIError) return new Error(`Claude API error ${err.status ?? ""}: ${err.message}`);
  if (err instanceof Error) return err;
  return new Error(String(err));
}
