import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Workflow } from "../../shared/types.js";
import type { Store } from "../db/store.js";

export const campaignInput = z.object({
  topic: z.string().trim().min(3).max(500),
  audience: z.string().trim().max(500).optional().default(""),
  goal: z.string().trim().max(1000).optional().default(""),
  /** Which villagers fill each role (defaults: the seeded Manager, Researcher and Copywriter). */
  managerId: z.string().optional(),
  researcherId: z.string().optional(),
  copywriterId: z.string().optional(),
});
export type CampaignInput = z.infer<typeof campaignInput>;

/**
 * Template: "Market research → copy → review".
 * A fixed dependency chain, so every hand-off is a real, persisted event:
 *   Manager writes the brief → Researcher researches → Copywriter writes → Manager reviews.
 * The final task's output is the deliverable shown in the dashboard.
 */
export function startCampaignWorkflow(store: Store, raw: unknown, override?: { manager: string; researcher: string; copywriter: string }, scheduleId: string | null = null): Workflow {
  const input = campaignInput.parse(raw);
  const ids = override ?? {
    manager: input.managerId ?? "manager",
    researcher: input.researcherId ?? "researcher",
    copywriter: input.copywriterId ?? "copywriter",
  };
  for (const [role, id] of Object.entries(ids)) {
    const a = store.getAgent(id);
    if (!a || !a.enabled || a.archived) throw new Error(`The ${role} role needs an active villager (got "${id}")`);
  }
  const context = [
    `Topic / product: ${input.topic}`,
    input.audience ? `Target audience: ${input.audience}` : null,
    input.goal ? `Goal: ${input.goal}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const wf = store.insertWorkflow({
    id: randomUUID(),
    template: "market-campaign",
    title: `Campaign: ${input.topic.slice(0, 80)}`,
    input: { topic: input.topic, audience: input.audience, goal: input.goal },
    finalTaskId: null,
    scheduleId,
  });

  const brief = store.createTask({
    title: `Brief: ${input.topic.slice(0, 80)}`,
    agentId: ids.manager,
    createdBy: "user",
    workflowId: wf.id,
    scheduleId,
    priority: 2,
    instructions: [
      context,
      "",
      "Write a short project brief for your team. Include:",
      "1. A research brief for the Researcher: the 3–6 questions that matter most (audience, competitors, positioning, channels).",
      "2. A copy brief for the Copywriter: deliverables (e.g. 3 headline options, a tagline, a landing-page hero section, 3 social posts), tone of voice and constraints.",
      "Do not do the research or write the copy yourself — your colleagues will receive this brief automatically.",
    ].join("\n"),
  });

  const research = store.createTask({
    title: `Research: ${input.topic.slice(0, 80)}`,
    agentId: ids.researcher,
    createdBy: ids.manager,
    workflowId: wf.id,
    scheduleId,
    priority: 2,
    dependsOn: [brief.id],
    parentTaskId: brief.id,
    instructions: [
      context,
      "",
      "Carry out the research brief from the Manager (below). Organise findings for the Copywriter, who will receive your report automatically.",
      "Keep it under ~900 words. Mark anything unverified as an assumption.",
    ].join("\n"),
  });

  const copy = store.createTask({
    title: `Copy: ${input.topic.slice(0, 80)}`,
    agentId: ids.copywriter,
    createdBy: ids.manager,
    workflowId: wf.id,
    scheduleId,
    priority: 2,
    dependsOn: [brief.id, research.id],
    parentTaskId: research.id,
    instructions: [
      context,
      "",
      "Write the marketing copy requested in the Manager's copy brief, grounded in the Researcher's findings (both below).",
      "Your draft goes to the Manager for review automatically. Do not publish anything.",
    ].join("\n"),
  });

  const review = store.createTask({
    title: `Review & deliver: ${input.topic.slice(0, 80)}`,
    agentId: ids.manager,
    createdBy: ids.manager,
    workflowId: wf.id,
    scheduleId,
    priority: 2,
    dependsOn: [research.id, copy.id],
    parentTaskId: copy.id,
    instructions: [
      context,
      "",
      "Review the Copywriter's draft against your brief and the research (below).",
      "Produce the FINAL deliverable for the human owner in Markdown:",
      "- `## Summary` (3 bullets on audience and positioning, from the research)",
      "- `## Final copy` (polished; fix any issues yourself)",
      "- `## Review notes` (what you changed and why, plus any claims the owner should verify before publishing).",
    ].join("\n"),
  });

  store.setWorkflowFinalTask(wf.id, review.id);
  for (const t of [brief, research, copy, review]) {
    store.addEvent({
      type: "task.created",
      agentId: t.agentId,
      taskId: t.id,
      message: `${t.status === "blocked" ? "Planned" : "Queued"}: ${t.title}`,
      data: { workflowId: wf.id },
    });
  }
  store.addEvent({ type: "workflow.created", message: `New project: ${wf.title}`, data: { workflowId: wf.id } });
  return store.getWorkflow(wf.id)!;
}
