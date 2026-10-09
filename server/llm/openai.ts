import OpenAI from "openai";
import type { GenerateRequest, GenerateResult, LLMProvider, StopReason, ToolResult } from "./provider.js";
import { NonRetryableError } from "./provider.js";
import { withSources } from "./anthropic.js";
import type { Effort } from "../../shared/types.js";

type InputItem = OpenAI.Responses.ResponseInputItem;
type OutputItem = OpenAI.Responses.ResponseOutputItem;

/**
 * Transcript entries for OpenAI villagers. One model turn produces several output items (text,
 * function calls, web searches, reasoning), so a turn is stored as one bundle of items and
 * flattened back into the Responses API `input` list, unchanged, on the next call.
 */
type OpenAIEntry = InputItem | { bundle: InputItem[] };

const TOOL_ITEM = new Set(["function_call", "web_search_call", "code_interpreter_call"]);

/** Models that take a reasoning effort (o-series, GPT-5 family, Codex). */
export function isOpenAIReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5|codex)/i.test(model);
}

function reasoningEffort(e: Effort): "low" | "medium" | "high" {
  return e === "low" ? "low" : e === "medium" ? "medium" : "high";
}

/**
 * OpenAI (GPT / Codex models) through the Responses API, on the owner's own key. Requests are
 * stateless (`store: false`): the conversation lives in Agentopia's task transcript, including
 * encrypted reasoning items, exactly like Claude villagers.
 */
export class OpenAIProvider implements LLMProvider {
  readonly id = "openai";
  readonly simulated = false;
  private readonly client: OpenAI;
  /** Models that rejected OpenAI's built-in tools (web search, code interpreter); they run without them. */
  private readonly noBuiltInTools = new Set<string>();

  constructor(apiKey: string, clientOptions: Omit<ConstructorParameters<typeof OpenAI>[0] & object, "apiKey"> = {}) {
    this.client = new OpenAI({ apiKey, maxRetries: 2, ...clientOptions });
  }

  userMessage(text: string): OpenAIEntry {
    return { role: "user", content: text, type: "message" };
  }

  toolResultsMessage(results: ToolResult[]): OpenAIEntry {
    return {
      bundle: results.map((r) => ({ type: "function_call_output" as const, call_id: r.toolCallId, output: r.isError ? `ERROR: ${r.content}` : r.content })),
    };
  }

  appendNote(messages: unknown[], note: string): unknown[] {
    return [...messages, this.userMessage(note)];
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const input = (req.messages as OpenAIEntry[]).flatMap((m) => ("bundle" in m ? m.bundle : [m]));
    const functions: OpenAI.Responses.Tool[] = req.tools.map((t) => ({
      type: "function" as const,
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
      strict: false,
    }));
    const builtIn: OpenAI.Responses.Tool[] = [];
    // OpenAI's web search also opens pages, so it covers both search and page reads.
    if (req.hostedTools.includes("web_search") || req.hostedTools.includes("web_fetch")) builtIn.push({ type: "web_search" });
    if (req.hostedTools.includes("code_execution")) builtIn.push({ type: "code_interpreter", container: { type: "auto" } });
    const reasoning = isOpenAIReasoningModel(req.model);

    const send = (tools: OpenAI.Responses.Tool[], instructions: string) =>
      this.client.responses.create(
        {
          model: req.model,
          instructions,
          input,
          max_output_tokens: req.maxTokens,
          store: false,
          ...(tools.length ? { tools } : {}),
          ...(tools.length && req.noTools ? { tool_choice: "none" as const } : {}),
          ...(reasoning ? { reasoning: { effort: reasoningEffort(req.effort) }, include: ["reasoning.encrypted_content" as const] } : {}),
        },
        { signal: req.signal },
      );

    // Older models (e.g. gpt-3.5-turbo, gpt-4) reject the built-in tools. Run without them and say so,
    // rather than failing the task; remember the model so later calls skip straight to that.
    const withoutBuiltIn = builtIn.length > 0 && this.noBuiltInTools.has(req.model);
    const missing = `${builtIn.map((t) => (t.type === "web_search" ? "web search" : "code execution")).join(" and ")} isn't available with ${req.model}`;
    const plainInstructions = `${req.system}\n\nNote: ${missing}, so work from what you already know and say plainly where current information would need checking.`;
    let skippedBuiltIn = withoutBuiltIn;
    let res: OpenAI.Responses.Response;
    try {
      try {
        res = withoutBuiltIn ? await send(functions, plainInstructions) : await send([...functions, ...builtIn], req.system);
      } catch (err) {
        if (!builtIn.length || withoutBuiltIn || !rejectsBuiltInTools(err)) throw err;
        this.noBuiltInTools.add(req.model);
        skippedBuiltIn = true;
        res = await send(functions, plainInstructions);
      }
    } catch (err) {
      throw mapError(err);
    }

    const output: OutputItem[] = res.output ?? [];
    const lastTool = output.reduce((last, item, i) => (TOOL_ITEM.has(item.type) ? i : last), -1);
    const notes: string[] = [];
    const answerParts: string[] = [];
    const citations: { url: string; title: string }[] = [];
    let refused = false;
    output.forEach((item, i) => {
      if (item.type !== "message") return;
      for (const c of item.content) {
        if (c.type === "refusal") refused = true;
        if (c.type !== "output_text") continue;
        for (const a of c.annotations ?? []) if (a.type === "url_citation") citations.push({ url: a.url, title: a.title });
        if (i < lastTool) notes.push(c.text.trim());
        else answerParts.push(c.text);
      }
    });
    const answer = answerParts.join("").trim();
    const text = answer ? withSources(answer, [{ citations }]) : notes.join("\n\n");

    const toolCalls = output
      .filter((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call")
      .map((c) => ({ id: c.call_id, name: c.name, input: parseArgs(c.arguments) }));

    const hostedActivity: string[] = skippedBuiltIn ? [`${missing[0].toUpperCase()}${missing.slice(1)}, so this answer comes without it`] : [];
    let searches = 0;
    let pageReads = 0;
    let codeRuns = 0;
    for (const item of output) {
      if (item.type === "web_search_call") {
        const action = item.action as { type: string; query?: string; queries?: string[]; url?: string };
        if (action?.type === "open_page") {
          pageReads += 1;
          hostedActivity.push(action.url ? `Read page: ${action.url}` : "Read a web page");
        } else if (action?.type === "search") {
          searches += 1;
          const q = action.query ?? action.queries?.[0];
          hostedActivity.push(q ? `Web search: “${q}”` : "Web search");
        }
      }
      if (item.type === "code_interpreter_call") {
        codeRuns += 1;
        hostedActivity.push("Ran code in sandbox");
      }
    }

    const u = res.usage;
    const cached = u?.input_tokens_details?.cached_tokens ?? 0;
    const written = u?.input_tokens_details?.cache_write_tokens ?? 0;
    const stopReason: StopReason = refused
      ? "refusal"
      : toolCalls.length
        ? "tool_use"
        : res.status === "incomplete" && res.incomplete_details?.reason === "max_output_tokens"
          ? "max_tokens"
          : "end_turn";

    return {
      assistantMessage: { bundle: output as unknown as InputItem[] } satisfies OpenAIEntry,
      text,
      toolCalls,
      stopReason,
      usage: {
        // OpenAI's input_tokens includes cached tokens; split them out so each is charged once.
        inputTokens: Math.max(0, (u?.input_tokens ?? 0) - cached - written),
        outputTokens: u?.output_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: written,
        webSearchRequests: searches,
        webFetchRequests: pageReads,
        codeExecutions: codeRuns,
      },
      servedModel: res.model ?? req.model,
      fallbackUsed: false,
      refusal: refused ? { category: null, explanation: null } : null,
      hostedActivity,
      notes,
      progressStreamed: false,
      requestId: (res as { _request_id?: string | null })._request_id ?? res.id ?? null,
      thinkingTokens: u?.output_tokens_details?.reasoning_tokens ?? null,
      serverIterations: null,
      contextTokens: u?.input_tokens ?? null,
    };
  }
}

function parseArgs(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { _unparseable_arguments: raw };
  }
}

/** A 400 saying the model doesn't support a built-in tool, e.g. "Tool 'web_search_preview' is not supported with gpt-3.5-turbo." */
function rejectsBuiltInTools(err: unknown): boolean {
  return err instanceof OpenAI.BadRequestError && /web_search|code_interpreter|\btool\b/i.test(err.message) && /not supported|unsupported|does not support/i.test(err.message);
}

function mapError(err: unknown): Error {
  if (err instanceof OpenAI.AuthenticationError) return new NonRetryableError("OpenAI rejected the API key (401). Check the key in Settings → API keys.");
  if (err instanceof OpenAI.PermissionDeniedError) return new NonRetryableError(`OpenAI permission denied (403): ${err.message}`);
  if (err instanceof OpenAI.NotFoundError) return new NonRetryableError(`OpenAI model or resource not found (404): ${err.message}`);
  if (err instanceof OpenAI.BadRequestError) return new NonRetryableError(`OpenAI rejected the request (400): ${err.message}`);
  if (err instanceof OpenAI.RateLimitError) return new Error(`Rate limited by OpenAI (429), will retry: ${err.message}`);
  if (err instanceof OpenAI.APIError) return new Error(`OpenAI error ${err.status ?? ""}: ${err.message}`);
  return err instanceof Error ? err : new Error(String(err));
}

/** Chat-capable models this key can use, from OpenAI's own list. */
export async function listOpenAIModels(apiKey: string, clientOptions: Omit<ConstructorParameters<typeof OpenAI>[0] & object, "apiKey"> = {}): Promise<string[]> {
  const client = new OpenAI({ apiKey, maxRetries: 1, ...clientOptions });
  const ids: string[] = [];
  for await (const m of client.models.list()) ids.push(m.id);
  return ids
    .filter((id) => /^(gpt-|o\d|codex|chatgpt-)/i.test(id) && !/(audio|realtime|tts|transcribe|image|embedding|search-preview|moderation|instruct)/i.test(id))
    .sort();
}
