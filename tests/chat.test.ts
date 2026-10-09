import { describe, expect, it } from "vitest";
import { ScriptedProvider, callTool, harness, say } from "./helpers.js";

type Msg = { role: string; content: unknown };
const text = (m: Msg) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));

describe("chatting with villagers", () => {
  it("continues the same conversation when the owner replies to a finished task", async () => {
    const provider = new ScriptedProvider([say("Draft 1: five brands."), say("Draft 2: shorter, three brands.")]);
    const h = harness(provider);
    const task = h.store.createTask({ agentId: "researcher", title: "Scan", instructions: "Find the leading brands.", createdBy: "user" });
    await h.runner.drain();
    expect(h.store.getTask(task.id)!.output).toBe("Draft 1: five brands.");

    const res = await h.request(`/api/tasks/${task.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Make it shorter, top three only." }) });
    expect(res.status).toBe(202);
    await h.runner.drain();

    // The second call carries the whole earlier conversation, then the owner's reply (append-only).
    const sent = provider.calls[1].messages as Msg[];
    expect(sent.slice(0, 2)).toEqual(provider.calls[0].messages.concat([{ role: "assistant", content: "Draft 1: five brands." }]));
    expect(text(sent[2])).toContain("Make it shorter, top three only.");
    expect(text(sent[2])).toContain("complete revised version");

    expect(h.store.getTask(task.id)).toMatchObject({ status: "completed", output: "Draft 2: shorter, three brands." });
    const thread = (await (await h.request(`/api/tasks/${task.id}/messages`)).json()) as { role: string; content: string }[];
    expect(thread.map((m) => [m.role, m.content])).toEqual([
      ["brief", "Find the leading brands."],
      ["agent", "Draft 1: five brands."],
      ["owner", "Make it shorter, top three only."],
      ["agent", "Draft 2: shorter, three brands."],
    ]);
    expect(h.store.listEvents({ taskId: task.id }).some((e) => e.type === "task.message")).toBe(true);
  });

  it("only accepts a reply once the villager has answered", async () => {
    const h = harness(new ScriptedProvider([say("done")]));
    const task = h.store.createTask({ agentId: "researcher", title: "Scan", instructions: "x", createdBy: "user" });
    const early = await h.request(`/api/tasks/${task.id}/messages`, { method: "POST", body: JSON.stringify({ text: "hello?" }) });
    expect(early.status).toBe(409);
    expect((await early.json()).error).toMatch(/still working/);
    expect((await h.request(`/api/tasks/nope/messages`, { method: "POST", body: JSON.stringify({ text: "hi" }) })).status).toBe(404);
    expect((await h.request(`/api/tasks/${task.id}/messages`, { method: "POST", body: JSON.stringify({ text: "  " }) })).status).toBe(400);
  });

  it("starts a free-form chat that earns no coins", async () => {
    const provider = new ScriptedProvider([say("Hi! Happy to help."), say("Sure: try oat-based bars.")]);
    const h = harness(provider);
    const res = await h.request("/api/chats", { method: "POST", body: JSON.stringify({ agentId: "copywriter", text: "Hey Quill, any ideas for a snack brand name?\nSomething playful." }) });
    expect(res.status).toBe(201);
    const chat = await res.json();
    expect(chat).toMatchObject({ kind: "chat", title: "Hey Quill, any ideas for a snack brand name?", agentId: "copywriter" });
    await h.runner.drain();
    expect(text((provider.calls[0].messages as Msg[])[0])).toContain("# Chat with the owner");
    expect(h.store.getTask(chat.id)!.output).toBe("Hi! Happy to help.");
    expect(h.store.listEvents({ taskId: chat.id }).some((e) => e.type === "reward.earned")).toBe(false);

    await h.request(`/api/tasks/${chat.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Something with oats?" }) });
    await h.runner.drain();
    expect(text((provider.calls[1].messages as Msg[]).at(-1)!)).toContain("Reply to the owner directly.");
    expect(h.store.getTask(chat.id)!.output).toBe("Sure: try oat-based bars.");
    expect((await h.request("/api/chats", { method: "POST", body: JSON.stringify({ agentId: "nobody", text: "hi" }) })).status).toBe(400);
  });

  it("gives each exchange its own research budget and turn count", async () => {
    const provider = new ScriptedProvider([
      () => ({ text: "Found it.", usage: { inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 6 } }),
      say("Two more sources."),
    ]);
    const h = harness(provider);
    const task = h.store.createTask({ agentId: "researcher", title: "Scan", instructions: "x", createdBy: "user", depth: "standard" });
    await h.runner.drain();
    await h.request(`/api/tasks/${task.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Find two more sources." }) });
    await h.runner.drain();
    // The first exchange used all six searches; the reply starts a fresh allowance instead of a forced write-up.
    expect(provider.calls[1].noTools).toBeUndefined();
    expect(h.store.getTask(task.id)!.output).toBe("Two more sources.");
  });

  it("answers unfinished tool steps before adding the owner's reply to a stopped task", async () => {
    const provider = new ScriptedProvider([callTool("remember", { note: "x" }), say("Picking up from here.")]);
    const h = harness(provider);
    const task = h.store.createTask({ agentId: "researcher", title: "Scan", instructions: "x", createdBy: "user" });
    // Stop right after the model asked for a tool, as a cancel would.
    const executorState = { messages: [{ role: "user", content: "brief" }, { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "remember", input: {} }] }], pendingToolCalls: [{ id: "tu_1", name: "remember", input: {} }], turns: 1 };
    h.store.saveConversation(task.id, executorState);
    h.store.updateTask(task.id, { status: "cancelled" });
    provider.calls.length = 0;
    (provider as unknown as { steps: unknown[] }).steps.shift();
    await h.request(`/api/tasks/${task.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Never mind the note, just answer." }) });
    await h.runner.drain();
    const sent = provider.calls[0].messages as Msg[];
    expect(text(sent[2])).toContain("Not run: the owner sent a new message instead.");
    expect(text(sent[3])).toContain("Never mind the note");
    expect(h.store.getTask(task.id)!.output).toBe("Picking up from here.");
  });

  it("keeps older tasks replyable and carries the conversation over on a retry", async () => {
    const provider = new ScriptedProvider([say("v1"), () => new Error("boom"), () => new Error("boom"), () => new Error("boom"), say("v2 after retry")]);
    const h = harness(provider, { maxAttempts: 3 } as never);
    const task = h.store.createTask({ agentId: "researcher", title: "Scan", instructions: "Find brands.", createdBy: "user" });
    // Simulate a task from before conversations were stored.
    h.store.db.prepare("DELETE FROM task_messages WHERE task_id = ?").run(task.id);
    await h.runner.drain();
    expect(h.store.listTaskMessages(task.id).map((m) => m.role)).toEqual(["brief", "agent"]);

    await h.request(`/api/tasks/${task.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Add prices." }) });
    await h.runner.drain();
    expect(h.store.getTask(task.id)!.status).toBe("failed");
    expect((await h.request(`/api/tasks/${task.id}/retry`, { method: "POST" })).status).toBe(200);
    await h.runner.drain();
    const brief = text((provider.calls.at(-1)!.messages as Msg[])[0]);
    expect(brief).toContain("## The conversation so far");
    expect(brief).toContain("Add prices.");
    expect(h.store.getTask(task.id)!.output).toBe("v2 after retry");
  });
});
