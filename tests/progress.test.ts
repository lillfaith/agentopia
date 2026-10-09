import { describe, expect, it } from "vitest";
import { ScriptedProvider, callTool, harness } from "./helpers.js";

describe("live progress updates", () => {
  it("shows the agent's updates as they work and keeps them out of the final answer", async () => {
    const provider = new ScriptedProvider([
      () => ({ ...callTool("remember", { note: "Owner likes purple." })(undefined as never), text: "First I'll note your colour preference." }),
      () => ({
        notes: ["Now searching the big retailers for prices."],
        hostedActivity: ["Web search: “purple water bottle price”"],
        text: "## Summary\nThe cheapest is **$4.97** at [Walmart](https://www.walmart.com/ip/123).",
      }),
    ]);
    const h = harness(provider);
    const task = h.store.createTask({ agentId: "researcher", title: "Water bottle finder", instructions: "Find the cheapest purple bottle", createdBy: "user" });
    await h.runner.drain();

    const events = h.store.listEvents({ taskId: task.id, limit: 100 });
    const progress = events.filter((e) => e.type === "task.progress").map((e) => e.message);
    expect(progress).toEqual(["First I'll note your colour preference.", "Now searching the big retailers for prices."]);
    expect(events.some((e) => e.type === "task.step" && e.message.includes("Web search"))).toBe(true);

    const done = h.store.getTask(task.id)!;
    expect(done.output).toBe("## Summary\nThe cheapest is **$4.97** at [Walmart](https://www.walmart.com/ip/123).");
    // The full answer is never cut short in the activity feed: it's the task output.
    expect(events.some((e) => e.type === "task.step" && e.message.includes("Summary"))).toBe(false);
  });

  it("asks agents to narrate their work and link their sources", async () => {
    const provider = new ScriptedProvider([() => ({ text: "Done, with plenty of detail for the owner to read in full." })]);
    const h = harness(provider);
    h.store.createTask({ agentId: "researcher", title: "t", instructions: "i", createdBy: "user" });
    await h.runner.drain();
    expect(provider.calls[0].system).toContain("Keep the owner in the loop");
    expect(provider.calls[0].system).toContain("Markdown links");
  });
});
