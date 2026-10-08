import { z } from "zod";
import type { Agent, Task, ToolInfo } from "../../shared/types.js";
import type { Store } from "../db/store.js";
import type { HostedTool } from "../llm/provider.js";

/**
 * Categories that ALWAYS require an explicit human approval before execution.
 * This is enforced by the executor and cannot be switched off per agent.
 */
export type Sensitivity = "none" | "external_communication" | "publish" | "spend" | "deploy" | "destructive";

export interface ToolContext {
  store: Store;
  agent: Agent;
  task: Task;
  maxDelegationDepth: number;
  simulated: boolean;
}

export interface ToolOutcome {
  content: string;
  isError?: boolean;
}

interface BaseTool {
  id: string;
  label: string;
  description: string;
  sensitivity: Sensitivity;
  implementation: "real" | "placeholder";
}

/** Executed by our server. */
export interface LocalTool<S extends z.ZodType = z.ZodType> extends BaseTool {
  kind: "local";
  schema: S;
  /** JSON schema shown to the model. May depend on the town (e.g. valid agent ids). */
  inputSchema(ctx: { store: Store; agent: Agent }): Record<string, unknown>;
  /** One-line description for logs and approval cards. */
  summarize(input: z.infer<S>): string;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolOutcome>;
}

/** Executed on the model provider's infrastructure. */
export interface ProviderHostedTool extends BaseTool {
  kind: "hosted";
  hosted: HostedTool;
}

export type ToolDefinition = LocalTool | ProviderHostedTool;

// ───────────────────────── delegate_task (real) ─────────────────────────

const delegateSchema = z.object({
  agent_id: z.string().min(1),
  title: z.string().min(1).max(200),
  instructions: z.string().min(1).max(8000),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
});

const PRIORITY = { low: 0, normal: 1, high: 2, urgent: 3 } as const;

const delegateTask: LocalTool<typeof delegateSchema> = {
  kind: "local",
  id: "delegate_task",
  label: "Delegate task",
  description:
    "Assign a new task to another agent in the town. It is queued and runs independently; you will not receive its result in this conversation.",
  sensitivity: "none",
  implementation: "real",
  schema: delegateSchema,
  inputSchema: ({ store, agent }) => {
    const others = store.listAgents().filter((a) => a.enabled && a.id !== agent.id);
    return {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          enum: others.map((a) => a.id),
          description: "Recipient. " + others.map((a) => `${a.id} = ${a.name} (${a.role})`).join("; "),
        },
        title: { type: "string", description: "Short task title (max 200 chars)." },
        instructions: { type: "string", description: "Complete, self-contained instructions for the recipient." },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
      },
      required: ["agent_id", "title", "instructions"],
      additionalProperties: false,
    };
  },
  summarize: (i) => `Delegate “${i.title}” to ${i.agent_id}`,
  async run(input, ctx) {
    const target = ctx.store.getAgent(input.agent_id);
    if (!target || !target.enabled) return { content: `No enabled agent with id "${input.agent_id}".`, isError: true };
    if (target.id === ctx.agent.id) return { content: "You cannot delegate to yourself.", isError: true };
    const depth = ctx.task.delegationDepth + 1;
    if (depth > ctx.maxDelegationDepth) {
      return { content: `Delegation depth limit (${ctx.maxDelegationDepth}) reached; finish this task yourself.`, isError: true };
    }
    const child = ctx.store.createTask({
      title: input.title,
      instructions: input.instructions,
      agentId: target.id,
      priority: PRIORITY[input.priority ?? "normal"],
      parentTaskId: ctx.task.id,
      workflowId: ctx.task.workflowId,
      projectId: ctx.task.projectId,
      createdBy: ctx.agent.id,
      delegationDepth: depth,
    });
    ctx.store.addEvent({
      type: "task.created",
      agentId: target.id,
      taskId: child.id,
      message: `${ctx.agent.name} delegated “${child.title}” to ${target.name}`,
      data: { createdBy: ctx.agent.id, parentTaskId: ctx.task.id },
      simulated: ctx.simulated,
    });
    ctx.store.addEvent({
      type: "task.handoff",
      agentId: ctx.agent.id,
      taskId: child.id,
      message: `${ctx.agent.name} → ${target.name}: ${child.title}`,
      data: { fromAgentId: ctx.agent.id, toAgentId: target.id, kind: "delegation" },
      simulated: ctx.simulated,
    });
    return { content: `Delegated as task ${child.id} to ${target.name}. It is now in their queue.` };
  },
};

// ───────────────────────── sensitive placeholders ─────────────────────────

const publishSchema = z.object({
  channel: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(50000),
});

const publishContent: LocalTool<typeof publishSchema> = {
  kind: "local",
  id: "publish_content",
  label: "Publish content",
  description:
    "Request to publish content to a public channel (blog, social, newsletter). ALWAYS requires human approval. " +
    "Phase 1 placeholder: on approval the content is recorded as ready-to-publish; nothing is posted externally.",
  sensitivity: "publish",
  implementation: "placeholder",
  schema: publishSchema,
  inputSchema: () => ({
    type: "object",
    properties: {
      channel: { type: "string", description: "Where it should be published, e.g. 'blog', 'linkedin'." },
      title: { type: "string" },
      body: { type: "string", description: "The full content to publish." },
    },
    required: ["channel", "title", "body"],
    additionalProperties: false,
  }),
  summarize: (i) => `Publish “${i.title}” to ${i.channel}`,
  async run(input, ctx) {
    ctx.store.addEvent({
      type: "system.notice",
      agentId: ctx.agent.id,
      taskId: ctx.task.id,
      message: `PLACEHOLDER: “${input.title}” approved for ${input.channel}. No external channel is connected, so nothing was posted.`,
      data: { placeholder: true, tool: "publish_content", channel: input.channel },
      simulated: ctx.simulated,
    });
    return {
      content:
        "Approved by a human. NOTE: no publishing integration is connected in this version, so the content was recorded " +
        "as approved-for-publishing but NOT posted. Tell the user it is ready to post manually.",
    };
  },
};

const emailSchema = z.object({
  to: z.string().min(3).max(320),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(50000),
});

const sendEmail: LocalTool<typeof emailSchema> = {
  kind: "local",
  id: "send_email",
  label: "Send email",
  description:
    "Request to send an email to an external recipient. ALWAYS requires human approval. " +
    "Phase 1 placeholder: on approval the email is recorded; nothing is actually sent.",
  sensitivity: "external_communication",
  implementation: "placeholder",
  schema: emailSchema,
  inputSchema: () => ({
    type: "object",
    properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
    required: ["to", "subject", "body"],
    additionalProperties: false,
  }),
  summarize: (i) => `Email “${i.subject}” to ${i.to}`,
  async run(input, ctx) {
    ctx.store.addEvent({
      type: "system.notice",
      agentId: ctx.agent.id,
      taskId: ctx.task.id,
      message: `PLACEHOLDER: email “${input.subject}” approved. No mail integration is connected, so nothing was sent.`,
      data: { placeholder: true, tool: "send_email" },
      simulated: ctx.simulated,
    });
    return { content: "Approved by a human, but no email integration is connected: the email was NOT sent. Tell the user." };
  },
};

// ───────────────────────── hosted (run on Anthropic's infrastructure) ─────────────────────────

export const webSearch: ProviderHostedTool = {
  kind: "hosted",
  id: "web_search",
  label: "Web search",
  description: "Search the public web (Claude's hosted web search; max 5 searches per model call, billed per search).",
  sensitivity: "none",
  implementation: "real",
  hosted: "web_search",
};

export const webFetch: ProviderHostedTool = {
  kind: "hosted",
  id: "web_fetch",
  label: "Web fetch",
  description: "Read the full text of a web page whose URL already appears in the conversation (hosted; max 5 per model call).",
  sensitivity: "none",
  implementation: "real",
  hosted: "web_fetch",
};

export const codeExecution: ProviderHostedTool = {
  kind: "hosted",
  id: "code_execution",
  label: "Code execution (sandbox)",
  description:
    "Run Python and shell commands in Anthropic's isolated sandbox (no internet, no access to this computer). Output returns as text.",
  sensitivity: "none",
  implementation: "real",
  hosted: "code_execution",
};

export const delegate = delegateTask as unknown as LocalTool;
export const publish = publishContent as unknown as LocalTool;
export const email = sendEmail as unknown as LocalTool;

export function requiresApproval(tool: ToolDefinition): boolean {
  return tool.sensitivity !== "none";
}

export function toolInfo(tool: ToolDefinition): ToolInfo {
  return {
    id: tool.id,
    label: tool.label,
    description: tool.description,
    requiresApproval: requiresApproval(tool),
    implementation: tool.implementation,
    runsOn: tool.kind,
  };
}
