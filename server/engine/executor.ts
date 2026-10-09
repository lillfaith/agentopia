import type { Agent, Task } from "../../shared/types.js";
import type { Config } from "../config.js";
import type { Store } from "../db/store.js";
import { buildBrief, buildSystemPrompt } from "../agents/prompt.js";
import { requiresApproval, type LocalTool } from "../agents/tools.js";
import { capabilitiesFor } from "../skills/index.js";
import { preflight, worstCaseCallCost } from "./budget.js";
import { depthSpendCap, planTaskRun, usesWebResearch, type DepthProfile } from "./depth.js";
import { estimateCostUsd } from "../llm/models.js";
import { NonRetryableError, type LLMProvider, type ProviderMessage, type ToolCall, type ToolResult } from "../llm/provider.js";

/** Persisted per-task executor state (stored in tasks.conversation). */
interface TaskState {
  messages: ProviderMessage[];
  /** Tool calls from the last assistant turn that have not been answered yet. */
  pendingToolCalls: ToolCall[] | null;
  turns: number;
  /** Largest prompt (tokens) of the last call; drives the depth's context limit. */
  lastContextTokens?: number;
}

/**
 * Added to the transcript before the final call when a depth limit is reached. It is stored, not
 * just sent: Claude's reasoning blocks are bound to the exact conversation they were written in,
 * so a transcript that differs from what the model saw could not be replayed later.
 */
export const WRAP_UP_NOTE =
  "(Agentopia: the research budget for this task is used up. Do not search or read more pages. " +
  "Write your final answer now from what you have found, say what you could not verify, and link the sources you used.)";

export type ExecOutcome =
  | { kind: "completed"; output: string }
  | { kind: "waiting_approval"; approvalIds: string[] }
  /** A global/agent budget would be exceeded: pause (no attempt burned) until `resumeAt`. */
  | { kind: "budget_hold"; message: string; resumeAt: string }
  | { kind: "failed"; error: string; retryable: boolean };

type WrapUpReason = "turns" | "searches" | "fetches" | "context" | "spend";
const WRAP_UP_REASONS: Record<WrapUpReason, string> = {
  turns: "model turns",
  searches: "web searches",
  fetches: "page reads",
  context: "context size",
  spend: "task spend",
};
/** Output allowance for the write-up call. */
const WRAP_UP_MAX_TOKENS = 8_000;
/** Start writing up once this share of the depth's spend ceiling is used. */
const SPEND_WRAP_UP_SHARE = 0.7;

const excerpt = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/**
 * Runs one task for one agent: a manual tool-use loop so every step can be
 * logged, costed, approval-gated and persisted (append-only) between turns.
 */
export class AgentExecutor {
  constructor(
    private readonly store: Store,
    private readonly provider: LLMProvider,
    private readonly config: Config,
  ) {}

  async execute(task: Task, signal: AbortSignal): Promise<ExecOutcome> {
    const stored = this.store.getAgent(task.agentId);
    if (!stored) return { kind: "failed", error: `Agent ${task.agentId} no longer exists`, retryable: false };
    // A model outside the owner's plan (e.g. after a downgrade) runs on the plan's default instead.
    const allowed = this.config.allowedModels;
    const own = allowed && !allowed.includes(stored.model) ? { ...stored, model: this.config.defaultModel } : stored;
    const sim = this.provider.simulated;
    const { local, specs, hosted, prompts } = capabilitiesFor(this.store, own);
    const system = buildSystemPrompt(own, prompts);

    // Research depth decides the model, effort and limits for this task. Fixed for the whole
    // task: model, effort and tools are part of the cached prompt prefix.
    const research = usesWebResearch(hosted);
    const plan = planTaskRun(task, own, { defaultDepth: this.store.getSettings().defaultDepth, allowedModels: allowed ?? null, research });
    const agent = { ...own, model: plan.model, effort: plan.effort };
    const depth = research ? plan.depth : null;
    const maxTurns = depth ? Math.min(depth.maxTurns, this.config.maxTurnsPerTask) : this.config.maxTurnsPerTask;
    const hostedLimits = depth
      ? { webSearchMaxUses: depth.maxSearches, webFetchMaxUses: depth.maxFetches, webFetchMaxContentTokens: depth.fetchMaxContentTokens }
      : undefined;
    if (depth && !task.depth) this.store.setTaskDepth(task.id, depth.id);

    let state = this.store.getConversation<TaskState>(task.id);
    if (!state) {
      const budget = depth ? { searches: depth.maxSearches, fetches: depth.maxFetches } : undefined;
      state = { messages: [this.provider.userMessage(buildBrief(this.store, task, budget))], pendingToolCalls: null, turns: 0 };
      this.store.saveConversation(task.id, state);
      if (depth) {
        const why = plan.modelReason ? ` on ${agent.model} (${plan.modelReason})` : ` on ${agent.model}`;
        this.store.addEvent({
          type: "task.step",
          agentId: agent.id,
          taskId: task.id,
          message: `${depth.label} research${why}: up to ${depth.maxSearches} searches and ${depth.maxFetches} page reads, ~$${depthSpendCap(depth, agent.model).toFixed(2)} max.`,
          data: { depth: depth.id, model: agent.model, effort: agent.effort },
          simulated: sim,
        });
      }
    }

    try {
      while (true) {
        if (signal.aborted) throw new Error("cancelled");

        // Resume point: answer outstanding tool calls (possibly after an approval pause).
        if (state.pendingToolCalls?.length) {
          const handled = await this.handleToolCalls(agent, task, local, state.pendingToolCalls);
          if (handled.kind === "waiting") return { kind: "waiting_approval", approvalIds: handled.approvalIds };
          state.messages.push(this.provider.toolResultsMessage(handled.results));
          state.pendingToolCalls = null;
          this.store.saveConversation(task.id, state);
        }

        if (state.turns >= this.config.maxTurnsPerTask) {
          return { kind: "failed", error: `Stopped after ${state.turns} model turns (AGENTOPIA_MAX_TURNS_PER_TASK).`, retryable: false };
        }

        // Research depth: once a limit is reached, the next call is a tool-free write-up.
        let wrapUp: string | null = depth && state.turns > 0 ? this.depthLimitReached(task.id, state, depth, maxTurns, agent.model) : null;
        let maxTokens = wrapUp ? Math.min(this.config.maxOutputTokens, WRAP_UP_MAX_TOKENS) : this.config.maxOutputTokens;
        if (!sim) {
          const promptChars = system.length + JSON.stringify(state.messages).length + JSON.stringify(specs).length;
          const reserve = (tokens: number, searches: number) =>
            worstCaseCallCost({ model: agent.model, promptChars, maxTokens: tokens, hostedTools: hosted, maxSearches: searches });
          const capUsd = depth ? depthSpendCap(depth, agent.model) : undefined;
          let gate = preflight(this.store, this.config, { agent, taskId: task.id, reserveUsd: reserve(maxTokens, wrapUp ? 0 : (depth?.maxSearches ?? 5)), capUsd });
          if (!gate.ok && gate.scope === "task" && depth && !wrapUp && state.turns > 0) {
            // Not enough budget left for more research, but maybe enough to write up what was found.
            const tokens = Math.min(this.config.maxOutputTokens, WRAP_UP_MAX_TOKENS);
            const fallback = preflight(this.store, this.config, { agent, taskId: task.id, reserveUsd: reserve(tokens, 0), capUsd });
            if (fallback.ok) {
              gate = fallback;
              wrapUp = "spend";
              maxTokens = tokens;
            }
          }
          if (!gate.ok) {
            if (gate.scope === "task") return { kind: "failed", error: gate.message, retryable: false };
            return { kind: "budget_hold", message: gate.message, resumeAt: gate.resumeAt };
          }
        }
        if (wrapUp) {
          state.messages = this.provider.appendNote
            ? this.provider.appendNote(state.messages, WRAP_UP_NOTE)
            : [...state.messages, this.provider.userMessage(WRAP_UP_NOTE)];
          this.store.saveConversation(task.id, state);
          this.store.addEvent({
            type: "task.step",
            agentId: agent.id,
            taskId: task.id,
            message: `${depth!.label} research limit reached (${WRAP_UP_REASONS[wrapUp as WrapUpReason] ?? wrapUp}); writing up the findings.`,
            data: { wrapUp, depth: depth!.id },
            simulated: sim,
          });
        }

        this.store.setAgentStatus(agent.id, "working", state.turns === 0 ? `Thinking about “${excerpt(task.title, 60)}”` : "Continuing…", task.id, sim);
        const progress = (kind: "note" | "activity", text: string) => {
          if (kind === "note") {
            // The agent's own words, shown in full to the owner as the work happens.
            this.store.addEvent({ type: "task.progress", agentId: agent.id, taskId: task.id, message: text.slice(0, 4000), simulated: sim });
            this.store.setAgentStatus(agent.id, "working", excerpt(text.replace(/\s+/g, " "), 140), task.id, sim);
          } else {
            this.store.addEvent({ type: "task.step", agentId: agent.id, taskId: task.id, message: text, data: { hosted: true }, simulated: sim });
          }
        };
        const result = await this.provider.generate({
          model: agent.model,
          effort: agent.effort,
          system,
          messages: state.messages,
          tools: specs,
          hostedTools: hosted,
          hostedLimits,
          maxTokens,
          ...(wrapUp ? { noTools: true } : {}),
          signal,
          onProgress: (p) => {
            if (!signal.aborted) progress(p.kind, p.text);
          },
        });
        state.turns += 1;
        if (result.contextTokens) state.lastContextTokens = result.contextTokens + result.usage.outputTokens;

        const cost = sim ? 0 : estimateCostUsd(result.servedModel, result.usage);
        this.store.recordUsage({
          agentId: agent.id,
          taskId: task.id,
          model: result.servedModel,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cacheReadTokens: result.usage.cacheReadTokens,
          cacheWriteTokens: result.usage.cacheWriteTokens,
          webSearchRequests: result.usage.webSearchRequests,
          webFetchRequests: result.usage.webFetchRequests ?? 0,
          codeExecutions: result.usage.codeExecutions ?? 0,
          costUsd: cost,
          simulated: sim,
          requestId: result.requestId,
          requestedModel: agent.model,
          thinkingTokens: result.thinkingTokens ?? null,
          serverIterations: result.serverIterations ?? null,
          contextTokens: result.contextTokens ?? null,
        });
        this.store.addEvent({
          type: "usage.recorded",
          agentId: agent.id,
          taskId: task.id,
          message: sim
            ? "Simulated call — no API request, 0 tokens, $0"
            : `Claude API ${result.requestId ?? "(no request id)"} · ${result.usage.inputTokens + result.usage.cacheReadTokens + result.usage.cacheWriteTokens} in / ${result.usage.outputTokens} out tokens · ~$${cost.toFixed(4)} (${result.servedModel})`,
          data: { ...result.usage, costUsd: cost, model: result.servedModel, fallbackUsed: result.fallbackUsed, requestId: result.requestId },
          simulated: sim,
        });

        // Append-only transcript: the assistant turn is stored exactly as returned.
        state.messages.push(result.assistantMessage);
        this.store.saveConversation(task.id, state);

        // Providers that don't stream report progress here, after the call.
        if (!result.progressStreamed) {
          for (const note of result.notes ?? []) progress("note", note);
          for (const note of result.hostedActivity) progress("activity", note);
        }
        if (result.fallbackUsed) {
          this.store.addEvent({
            type: "system.notice",
            agentId: agent.id,
            taskId: task.id,
            message: `Request was declined by ${agent.model} and completed by fallback model ${result.servedModel}.`,
            simulated: sim,
          });
        }
        // Text in a turn that goes on to use a tool is a progress update; a final answer becomes the task output.
        if (result.text && result.stopReason === "tool_use" && result.toolCalls.length && !result.progressStreamed) progress("note", result.text);

        switch (result.stopReason) {
          case "refusal": {
            const why = result.refusal?.category ? ` (category: ${result.refusal.category})` : "";
            return { kind: "failed", error: `The model declined this request${why}.`, retryable: false };
          }
          case "pause_turn":
            if (wrapUp) return { kind: "completed", output: result.text };
            continue; // hosted tool loop paused; re-send to let it continue
          case "tool_use":
            if (!result.toolCalls.length || wrapUp) return { kind: "completed", output: result.text };
            state.pendingToolCalls = result.toolCalls;
            this.store.saveConversation(task.id, state);
            continue;
          case "max_tokens":
            if (result.toolCalls.length) {
              return { kind: "failed", error: "Output hit max_tokens while writing a tool call; raise AGENTOPIA_MAX_OUTPUT_TOKENS.", retryable: false };
            }
            return { kind: "completed", output: `${result.text}\n\n_[Output truncated at the max_tokens limit.]_` };
          default:
            return { kind: "completed", output: result.text };
        }
      }
    } catch (err) {
      if (signal.aborted) return { kind: "failed", error: "Cancelled", retryable: false };
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "failed", error: message, retryable: !(err instanceof NonRetryableError) };
    }
  }

  /** Which research-depth limit, if any, the next call would cross. */
  private depthLimitReached(taskId: string, state: TaskState, depth: DepthProfile, maxTurns: number, model: string): WrapUpReason | null {
    if (state.turns >= maxTurns - 1) return "turns";
    const used = this.store.taskToolUse(taskId);
    if (used.webSearches >= depth.maxSearches) return "searches";
    if (used.webFetches >= depth.maxFetches) return "fetches";
    if ((state.lastContextTokens ?? 0) >= depth.maxContextTokens) return "context";
    if (!this.provider.simulated && this.store.taskSpend(taskId) >= depthSpendCap(depth, model) * SPEND_WRAP_UP_SHARE) return "spend";
    return null;
  }

  /**
   * Validate and run the tool calls of one assistant turn. Sensitive calls are
   * checked first: if any still needs a human decision, NOTHING runs yet, so no
   * tool is executed twice when the task resumes.
   */
  private async handleToolCalls(
    agent: Agent,
    task: Task,
    local: LocalTool[],
    calls: ToolCall[],
  ): Promise<{ kind: "ok"; results: ToolResult[] } | { kind: "waiting"; approvalIds: string[] }> {
    const sim = this.provider.simulated;
    const byId = new Map(local.map((t) => [t.id, t]));
    const existing = this.store.listApprovals({ taskId: task.id, limit: 500 });

    // Pass 1: approvals.
    const pending: string[] = [];
    for (const call of calls) {
      const tool = byId.get(call.name);
      if (!tool || !requiresApproval(tool)) continue;
      const parsed = tool.schema.safeParse(call.input);
      if (!parsed.success) continue; // reported as an error in pass 2
      const approval = existing.find((a) => a.toolUseId === call.id);
      if (!approval) {
        const created = this.store.createApproval({
          taskId: task.id,
          agentId: agent.id,
          toolId: tool.id,
          toolUseId: call.id,
          summary: tool.summarize(parsed.data),
          input: parsed.data,
        });
        this.store.addEvent({
          type: "task.approval_requested",
          agentId: agent.id,
          taskId: task.id,
          message: `${agent.name} needs approval: ${created.summary}`,
          data: { approvalId: created.id, toolId: tool.id },
          simulated: sim,
        });
        pending.push(created.id);
      } else if (approval.status === "pending") {
        pending.push(approval.id);
      }
    }
    if (pending.length) return { kind: "waiting", approvalIds: pending };

    // Pass 2: execute in order.
    const results: ToolResult[] = [];
    for (const call of calls) {
      const tool = byId.get(call.name);
      if (!tool) {
        results.push({ toolCallId: call.id, content: `Tool "${call.name}" is not authorised for ${agent.name}.`, isError: true });
        continue;
      }
      const parsed = tool.schema.safeParse(call.input);
      if (!parsed.success) {
        results.push({ toolCallId: call.id, content: `Invalid input for ${tool.id}: ${parsed.error.message}`, isError: true });
        continue;
      }
      if (requiresApproval(tool)) {
        const approval = existing.find((a) => a.toolUseId === call.id) ?? this.store.listApprovals({ taskId: task.id }).find((a) => a.toolUseId === call.id);
        if (approval?.status !== "approved") {
          results.push({
            toolCallId: call.id,
            content: `A human rejected this action${approval?.note ? `: ${approval.note}` : "."} Do not retry it; finish the task without it.`,
            isError: true,
          });
          continue;
        }
      }
      // Exactly-once: if this call already ran (e.g. before a crash), reuse its recorded result.
      const prior = this.store.getToolRun(task.id, call.id);
      if (prior) {
        results.push({ toolCallId: call.id, content: prior.content, isError: prior.isError });
        continue;
      }
      const summary = tool.summarize(parsed.data);
      this.store.addEvent({ type: "task.tool_call", agentId: agent.id, taskId: task.id, message: summary, data: { toolId: tool.id }, simulated: sim });
      if (tool.id === "delegate_task") this.store.setAgentStatus(agent.id, "delivering", summary, task.id, sim);
      try {
        const outcome = await tool.run(parsed.data, {
          store: this.store,
          agent,
          task,
          maxDelegationDepth: this.config.maxDelegationDepth,
          simulated: sim,
        });
        this.store.saveToolRun(task.id, call.id, tool.id, outcome.content, !!outcome.isError);
        results.push({ toolCallId: call.id, content: outcome.content, isError: outcome.isError });
      } catch (err) {
        const content = `Tool failed: ${err instanceof Error ? err.message : String(err)}`;
        this.store.saveToolRun(task.id, call.id, tool.id, content, true);
        results.push({ toolCallId: call.id, content, isError: true });
      }
    }
    return { kind: "ok", results };
  }
}
