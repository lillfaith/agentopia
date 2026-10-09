import { FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel, type Content, type GenerateContentConfig, type HttpOptions, type Part, type Tool } from "@google/genai";
import type { GenerateRequest, GenerateResult, LLMProvider, StopReason, ToolResult } from "./provider.js";
import { NonRetryableError } from "./provider.js";
import { withSources } from "./anthropic.js";
import type { Effort } from "../../shared/types.js";

type GeminiOptions = HttpOptions;

/** Gemini 3 models take a thinking level; earlier ones manage thinking themselves. */
function thinkingLevel(model: string, e: Effort): ThinkingLevel | undefined {
  if (!/gemini-3/i.test(model)) return undefined;
  return e === "low" ? ThinkingLevel.LOW : e === "medium" ? ThinkingLevel.MEDIUM : ThinkingLevel.HIGH;
}

/**
 * Tool calls are identified by "name|id": Gemini needs the function name on the response,
 * and Agentopia's tool results only carry the id.
 */
const callId = (name: string, id: string) => `${name}|${id}`;
const splitCallId = (v: string) => {
  const i = v.indexOf("|");
  return i < 0 ? { name: v, id: undefined } : { name: v.slice(0, i), id: v.slice(i + 1) || undefined };
};

/**
 * Google Gemini through the Gen AI SDK, on the owner's own key. The model's turns (including
 * thought signatures and function calls) are stored exactly as returned and replayed unchanged.
 */
export class GeminiProvider implements LLMProvider {
  readonly id = "gemini";
  readonly simulated = false;
  private readonly ai: GoogleGenAI;
  private counter = 0;
  /** Models that rejected the built-in tools (Google Search, code execution) here; they run without them. */
  private readonly noBuiltInTools = new Set<string>();

  constructor(apiKey: string, httpOptions?: GeminiOptions) {
    this.ai = new GoogleGenAI({ apiKey, ...(httpOptions ? { httpOptions } : {}) });
  }

  userMessage(text: string): Content {
    return { role: "user", parts: [{ text }] };
  }

  toolResultsMessage(results: ToolResult[]): Content {
    return {
      role: "user",
      parts: results.map((r) => {
        const { name, id } = splitCallId(r.toolCallId);
        return { functionResponse: { ...(id ? { id } : {}), name, response: r.isError ? { error: r.content } : { output: r.content } } };
      }),
    };
  }

  appendNote(messages: unknown[], note: string): unknown[] {
    const last = messages[messages.length - 1] as Content | undefined;
    if (last?.role === "user") return [...messages.slice(0, -1), { ...last, parts: [...(last.parts ?? []), { text: note }] }];
    return [...messages, this.userMessage(note)];
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const functions: Tool[] = req.tools.length
      ? [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.inputSchema })) }]
      : [];
    const builtIn: Tool[] = [];
    if (req.hostedTools.includes("web_search") || req.hostedTools.includes("web_fetch")) builtIn.push({ googleSearch: {} });
    if (req.hostedTools.includes("code_execution")) builtIn.push({ codeExecution: {} });
    const level = thinkingLevel(req.model, req.effort);
    const configFor = (tools: Tool[], systemInstruction: string): GenerateContentConfig => ({
      systemInstruction,
      maxOutputTokens: req.maxTokens,
      abortSignal: req.signal,
      ...(tools.length ? { tools } : {}),
      ...(req.noTools && req.tools.length
        ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } } }
        : req.tools.length && tools.length > 1
          ? { toolConfig: { includeServerSideToolInvocations: true } } // Google Search alongside our own tools
          : {}),
      ...(level ? { thinkingConfig: { thinkingLevel: level } } : {}),
    });
    const send = (config: GenerateContentConfig) => this.ai.models.generateContent({ model: req.model, contents: req.messages as Content[], config });

    // Some models reject Google Search or code execution, or combining them with our own tools
    // (Gemini before 3). Run without them and say so, rather than failing; remember the model.
    const withoutBuiltIn = builtIn.length > 0 && this.noBuiltInTools.has(req.model);
    const missing = `${builtIn.map((t) => (t.googleSearch ? "Google Search" : "code execution")).join(" and ")} isn't available with ${req.model}${req.tools.length ? " alongside this villager's other tools" : ""}`;
    const plainSystem = `${req.system}\n\nNote: ${missing}, so work from what you already know and say plainly where current information would need checking.`;
    let skippedBuiltIn = withoutBuiltIn;
    let res: Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>;
    try {
      try {
        res = withoutBuiltIn ? await send(configFor(functions, plainSystem)) : await send(configFor([...functions, ...builtIn], req.system));
      } catch (err) {
        if (!builtIn.length || withoutBuiltIn || !rejectsBuiltInTools(err)) throw err;
        this.noBuiltInTools.add(req.model);
        skippedBuiltIn = true;
        res = await send(configFor(functions, plainSystem));
      }
    } catch (err) {
      throw mapError(err);
    }

    const cand = res.candidates?.[0];
    const parts: Part[] = cand?.content?.parts ?? [];
    const lastCall = parts.reduce((last, p, i) => (p.functionCall || p.toolCall || p.executableCode ? i : last), -1);
    const notes: string[] = [];
    const answerParts: string[] = [];
    parts.forEach((p, i) => {
      if (!p.text || p.thought) return;
      if (i < lastCall) notes.push(p.text.trim());
      else answerParts.push(p.text);
    });
    const grounding = cand?.groundingMetadata;
    const citations = (grounding?.groundingChunks ?? [])
      .map((c) => c.web)
      .filter((w): w is { uri: string; title?: string } => !!w?.uri)
      .map((w) => ({ url: w.uri, title: w.title ?? "" }));
    const answer = answerParts.join("").trim();
    const text = answer ? withSources(answer, [{ citations }]) : notes.join("\n\n");

    const toolCalls = parts
      .filter((p) => p.functionCall?.name)
      .map((p) => ({ id: callId(p.functionCall!.name!, p.functionCall!.id ?? `call_${++this.counter}`), name: p.functionCall!.name!, input: p.functionCall!.args ?? {} }));
    // Keep our generated ids on the stored turn so the function responses can match them.
    const content: Content = cand?.content?.parts?.length
      ? {
          ...cand.content,
          role: "model",
          parts: parts.map((p) => {
            if (!p.functionCall?.name) return p;
            const match = toolCalls.find((t) => t.name === p.functionCall!.name && (!p.functionCall!.id || t.id.endsWith(`|${p.functionCall!.id}`)));
            return match && !p.functionCall.id ? { ...p, functionCall: { ...p.functionCall, id: splitCallId(match.id).id } } : p;
          }),
        }
      : { role: "model", parts: [{ text: text || "(no reply)" }] };

    const queries = grounding?.webSearchQueries ?? [];
    const hostedActivity = [...(skippedBuiltIn ? [`${missing}, so this answer comes without it`] : []), ...queries.map((q) => `Web search: “${q}”`)];
    const codeRuns = parts.filter((p) => p.executableCode).length;
    if (codeRuns) hostedActivity.push(...Array(codeRuns).fill("Ran code in sandbox"));

    const u = res.usageMetadata;
    const prompt = (u?.promptTokenCount ?? 0) + (u?.toolUsePromptTokenCount ?? 0);
    const cached = u?.cachedContentTokenCount ?? 0;
    const thoughts = u?.thoughtsTokenCount ?? 0;
    const reason = cand?.finishReason as string | undefined;
    const stopReason: StopReason = toolCalls.length
      ? "tool_use"
      : reason === "MAX_TOKENS"
        ? "max_tokens"
        : reason && /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/.test(reason)
          ? "refusal"
          : !cand && res.promptFeedback?.blockReason
            ? "refusal"
            : "end_turn";

    return {
      assistantMessage: content,
      text,
      toolCalls,
      stopReason,
      usage: {
        // Gemini's prompt count includes cached tokens; reasoning ("thoughts") is billed as output.
        inputTokens: Math.max(0, prompt - cached),
        outputTokens: (u?.candidatesTokenCount ?? 0) + thoughts,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
        webSearchRequests: queries.length,
        webFetchRequests: 0,
        codeExecutions: codeRuns,
      },
      servedModel: res.modelVersion ?? req.model,
      fallbackUsed: false,
      refusal: stopReason === "refusal" ? { category: reason ?? res.promptFeedback?.blockReason ?? null, explanation: null } : null,
      hostedActivity,
      notes,
      progressStreamed: false,
      requestId: res.responseId ?? null,
      thinkingTokens: thoughts || null,
      serverIterations: null,
      contextTokens: prompt || null,
    };
  }
}

/** A 400 saying the model can't use a built-in tool here (e.g. "Tool use with function calling is unsupported"). */
function rejectsBuiltInTools(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const message = err instanceof Error ? err.message : String(err);
  return status === 400 && /search|code.?execution|tool/i.test(message) && /not supported|unsupported|not enabled|please use/i.test(message);
}

function mapError(err: unknown): Error {
  const status = (err as { status?: number })?.status;
  const message = err instanceof Error ? err.message : String(err);
  if (status === 401 || status === 403) return new NonRetryableError(`Gemini rejected the API key (${status}). Check the key in Settings → API keys.`);
  if (status === 400 || status === 404) return new NonRetryableError(`Gemini rejected the request (${status}): ${message}`);
  if (status === 429) return new Error(`Rate limited by Gemini (429), will retry: ${message}`);
  return err instanceof Error ? err : new Error(message);
}

/** Text models this key can use, from Google's own list. */
export async function listGeminiModels(apiKey: string, httpOptions?: GeminiOptions): Promise<string[]> {
  const ai = new GoogleGenAI({ apiKey, ...(httpOptions ? { httpOptions } : {}) });
  const ids: string[] = [];
  const pager = await ai.models.list({ config: { pageSize: 100 } });
  for await (const m of pager) {
    const name = (m.name ?? "").replace(/^models\//, "");
    if (/^gemini/i.test(name) && (m.supportedActions ?? ["generateContent"]).includes("generateContent") && !/(image|tts|audio|live|embedding)/i.test(name)) ids.push(name);
  }
  return ids.sort();
}
