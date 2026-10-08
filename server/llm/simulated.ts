import type { GenerateRequest, GenerateResult, LLMProvider, ToolResult } from "./provider.js";

export const SIMULATION_BANNER = "[SIMULATED OUTPUT — no AI model was called]";

interface SimMessage {
  role: "user" | "assistant";
  content: string | SimBlock[];
}
type SimBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

/**
 * OFFLINE SIMULATOR. Exists so the town can be explored and tested without an
 * API key. It never contacts any model; every output is prefixed with
 * SIMULATION_BANNER, costs $0, and tasks it touches are flagged `simulated`.
 * It exercises the same executor paths (tool calls, approvals, delegation) as
 * the real provider so those paths are testable.
 */
export class SimulatedProvider implements LLMProvider {
  readonly id = "simulation";
  readonly simulated = true;
  private counter = 0;

  constructor(private readonly latencyMs = 3500) {}

  userMessage(text: string): SimMessage {
    return { role: "user", content: text };
  }

  toolResultsMessage(results: ToolResult[]): SimMessage {
    return {
      role: "user",
      content: results.map((r) => ({ type: "tool_result", tool_use_id: r.toolCallId, content: r.content, is_error: r.isError })),
    };
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (this.latencyMs > 0) await sleep(this.latencyMs, req.signal);
    const msgs = req.messages as SimMessage[];
    const first = msgs[0];
    const brief = typeof first?.content === "string" ? first.content : "";
    const last = msgs[msgs.length - 1];
    const answeringTool = Array.isArray(last?.content) && last.content.some((b) => b.type === "tool_result");
    const toolNames = new Set(req.tools.map((t) => t.name));
    // Only the task title triggers simulated tool use (e.g. "Publish a launch post"), never the body.
    const title = /^# Task: (.*)$/m.exec(brief)?.[1] ?? "";

    // First turn: optionally exercise a tool so approval/delegation paths run end-to-end.
    if (!answeringTool) {
      if (toolNames.has("publish_content") && /\bpublish\b/i.test(title)) {
        return this.toolTurn(req, "publish_content", {
          channel: "blog",
          title: "Simulated post",
          body: `${SIMULATION_BANNER}\nDraft content for: ${firstLine(brief)}`,
        });
      }
      const delegate = req.tools.find((t) => t.name === "delegate_task");
      if (delegate && /\bdelegate\b/i.test(title)) {
        const ids = ((delegate.inputSchema.properties as Record<string, { enum?: string[] }>)?.agent_id?.enum ?? []) as string[];
        if (ids.length) {
          return this.toolTurn(req, "delegate_task", {
            agent_id: ids[0],
            title: "Simulated follow-up",
            instructions: `${SIMULATION_BANNER} Follow-up work for: ${firstLine(brief)}`,
          });
        }
      }
    }

    const text = [
      SIMULATION_BANNER,
      "",
      `Role: ${firstLine(req.system)}`,
      `Brief: ${firstLine(brief) || "(continuation)"}`,
      "",
      "This placeholder stands in for model output so the town can be demoed offline.",
      "Configure ANTHROPIC_API_KEY to have this agent do real work.",
    ].join("\n");
    return this.result(req, [{ type: "text", text }], text, [], "end_turn");
  }

  private toolTurn(req: GenerateRequest, name: string, input: unknown): GenerateResult {
    const id = `sim_tool_${++this.counter}`;
    return this.result(req, [{ type: "tool_use", id, name, input }], "", [{ id, name, input }], "tool_use");
  }

  private result(
    req: GenerateRequest,
    content: SimBlock[],
    text: string,
    toolCalls: GenerateResult["toolCalls"],
    stopReason: GenerateResult["stopReason"],
  ): GenerateResult {
    return {
      assistantMessage: { role: "assistant", content } satisfies SimMessage,
      text,
      toolCalls,
      stopReason,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 },
      servedModel: `${req.model} (simulated)`,
      fallbackUsed: false,
      refusal: null,
      hostedActivity: [],
    };
  }
}

function firstLine(s: string): string {
  return (s.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 160);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    });
  });
}
