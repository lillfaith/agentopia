import type { Agent, Task } from "../../shared/types.js";
import type { Config } from "../config.js";
import type { Store } from "../db/store.js";
import { buildBrief, buildSystemPrompt } from "../agents/prompt.js";
import { requiresApproval, type LocalTool } from "../agents/tools.js";
import { capabilitiesFor } from "../skills/index.js";
import { preflight, worstCaseCallCost } from "./budget.js";
import { estimateCostUsd } from "../llm/models.js";
import { NonRetryableError, type LLMProvider, type ProviderMessage, type ToolCall, type ToolResult } from "../llm/provider.js";

/** Persisted per-task executor state (stored in tasks.conversation). */
interface TaskState {
  messages: ProviderMessage[];
  /** Tool calls from the last assistant turn that have not been answered yet. */
  pendingToolCalls: ToolCall[] | null;
  turns: number;
}

export type ExecOutcome =
  | { kind: "completed"; output: string }
  | { kind: "waiting_approval"; approvalIds: string[] }
  /** A global/agent budget would be exceeded: pause (no attempt burned) until `resumeAt`. */
  | { kind: "budget_hold"; message: string; resumeAt: string }
  | { kind: "failed"; error: string; retryable: boolean };

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
    const agent = allowed && !allowed.includes(stored.model) ? { ...stored, model: this.config.defaultModel } : stored;
    const sim = this.provider.simulated;
    const { local, specs, hosted, prompts } = capabilitiesFor(this.store, agent);
    const system = buildSystemPrompt(agent, prompts);

    let state = this.store.getConversation<TaskState>(task.id);
    if (!state) {
      state = { messages: [this.provider.userMessage(buildBrief(this.store, task))], pendingToolCalls: null, turns: 0 };
      this.store.saveConversation(task.id, state);
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
        if (!sim) {
          const reserveUsd = worstCaseCallCost({
            model: agent.model,
            promptChars: system.length + JSON.stringify(state.messages).length + JSON.stringify(specs).length,
            maxTokens: this.config.maxOutputTokens,
            hostedTools: hosted,
          });
          const gate = preflight(this.store, this.config, { agent, taskId: task.id, reserveUsd });
          if (!gate.ok) {
            if (gate.scope === "task") return { kind: "failed", error: gate.message, retryable: false };
            return { kind: "budget_hold", message: gate.message, resumeAt: gate.resumeAt };
          }
        }

        this.store.setAgentStatus(agent.id, "working", state.turns === 0 ? `Thinking about “${excerpt(task.title, 60)}”` : "Continuing…", task.id, sim);
        const result = await this.provider.generate({
          model: agent.model,
          effort: agent.effort,
          system,
          messages: state.messages,
          tools: specs,
          hostedTools: hosted,
          maxTokens: this.config.maxOutputTokens,
          signal,
        });
        state.turns += 1;

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

        for (const note of result.hostedActivity) {
          this.store.addEvent({ type: "task.step", agentId: agent.id, taskId: task.id, message: note, data: { hosted: true }, simulated: sim });
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
        if (result.text) {
          this.store.addEvent({ type: "task.step", agentId: agent.id, taskId: task.id, message: excerpt(result.text.replace(/\s+/g, " ")), simulated: sim });
        }

        switch (result.stopReason) {
          case "refusal": {
            const why = result.refusal?.category ? ` (category: ${result.refusal.category})` : "";
            return { kind: "failed", error: `The model declined this request${why}.`, retryable: false };
          }
          case "pause_turn":
            continue; // hosted tool loop paused; re-send to let it continue
          case "tool_use":
            if (!result.toolCalls.length) return { kind: "completed", output: result.text };
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
