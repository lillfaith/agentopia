import type { Effort } from "../../shared/types.js";
import type { TokenUsage } from "./models.js";

/**
 * Provider-neutral interface the agent executor talks to. Conversation messages
 * are opaque, provider-native values: the executor stores and replays them
 * verbatim (append-only), it never inspects or edits them.
 */
export type ProviderMessage = unknown;

/** A client-side tool the executor implements. JSON-schema input. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Provider-hosted tools (executed on the provider's infrastructure). */
export type HostedTool = "web_search" | "web_fetch" | "code_execution";

export interface GenerateRequest {
  model: string;
  effort: Effort;
  system: string;
  messages: ProviderMessage[];
  tools: ToolSpec[];
  hostedTools: HostedTool[];
  maxTokens: number;
  signal?: AbortSignal;
  /**
   * Live progress while the call runs (streaming providers): "note" is the agent's
   * own short update written before a tool step; "activity" describes a hosted
   * tool step (a web search, a page read). Called in order, as each block completes.
   */
  onProgress?: (p: { kind: "note" | "activity"; text: string }) => void;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "pause_turn" | "other";

export interface GenerateResult {
  /** Assistant turn to append to the conversation verbatim. */
  assistantMessage: ProviderMessage;
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage: TokenUsage;
  /** Model that actually produced the final output (differs from request on fallback). */
  servedModel: string;
  fallbackUsed: boolean;
  refusal: { category: string | null; explanation: string | null } | null;
  /** Human-readable notes on hosted-tool activity, e.g. web searches run. */
  hostedActivity: string[];
  /** The agent's own progress updates in this response (text written before a tool step). */
  notes?: string[];
  /** True when notes and hosted activity were already delivered through onProgress. */
  progressStreamed?: boolean;
  /** Provider request id (Anthropic `request-id` header). null for the simulator. */
  requestId: string | null;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface LLMProvider {
  readonly id: string;
  /** True for the offline simulator — its output must never be presented as real. */
  readonly simulated: boolean;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  userMessage(text: string): ProviderMessage;
  toolResultsMessage(results: ToolResult[]): ProviderMessage;
}

/** Errors that should not be retried (bad request, auth, permission). */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}
