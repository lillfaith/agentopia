import { describe, expect, it } from "vitest";
import { DAILY_TASK_COIN_CAP, achievements, coinBalance, ledger, rewardTask } from "../server/engine/rewards.js";
import { ScriptedProvider, callTool, harness, say } from "./helpers.js";

const LONG = "Here is a thorough answer with real substance, covering the brief point by point so the owner can act on it today.";

async function runTask(h: ReturnType<typeof harness>, title: string, instructions = `Do ${title}`) {
  const task = h.store.createTask({ agentId: "researcher", title, instructions, createdBy: "user" });
  await h.runner.drain();
  return h.store.getTask(task.id)!;
}

describe("coins for verified work", () => {
  it("awards a verified task once, plus the first-task achievement", async () => {
    const h = harness(new ScriptedProvider([say(LONG)]));
    const task = await runTask(h, "Market scan");
    expect(task.status).toBe("completed");
    expect(coinBalance(h.store)).toBe(10 + 25);
    expect(achievements(h.store).find((a) => a.id === "first-task")!.unlockedAt).toBeTruthy();
    expect(h.store.listEvents({ limit: 50 }).some((e) => e.type === "reward.earned")).toBe(true);

    // Idempotent: re-running the award (retries, restarts) changes nothing.
    expect(rewardTask(h.store, task.id, false)).toBe(0);
    expect(coinBalance(h.store)).toBe(35);
  });

  it("pays nothing for simulated, trivial or failed work", async () => {
    const sim = harness(new ScriptedProvider([say(LONG)], true));
    await runTask(sim, "Simulated");
    expect(coinBalance(sim.store)).toBe(0);

    const short = harness(new ScriptedProvider([say("ok")]));
    await runTask(short, "Tiny");
    expect(coinBalance(short.store)).toBe(0);

    const failing = harness(new ScriptedProvider([() => new Error("x"), () => new Error("x"), () => new Error("x")]));
    const t = await runTask(failing, "Doomed");
    expect(t.status).toBe("failed");
    expect(coinBalance(failing.store)).toBe(0);
  });

  it("doesn't pay twice for the same brief within a day", async () => {
    const h = harness(new ScriptedProvider([say(LONG), say(LONG)]));
    await runTask(h, "Write a tagline", "Lavender latte");
    await runTask(h, "  write a TAGLINE ", "lavender   latte");
    const taskRows = ledger(h.store).filter((e) => e.ref.startsWith("task:"));
    expect(taskRows.map((e) => e.amount).sort()).toEqual([0, 10]);
    expect(taskRows.find((e) => e.amount === 0)!.reason).toMatch(/same brief/);
  });

  it("caps task coins per day", async () => {
    const n = DAILY_TASK_COIN_CAP / 10 + 3;
    const h = harness(new ScriptedProvider(Array.from({ length: n }, () => say(LONG))));
    for (let i = 0; i < n; i++) await runTask(h, `Task ${i}`);
    const fromTasks = ledger(h.store, 500).filter((e) => e.ref.startsWith("task:")).reduce((s, e) => s + e.amount, 0);
    expect(fromTasks).toBe(DAILY_TASK_COIN_CAP);
    expect(achievements(h.store).find((a) => a.id === "tasks-10")!.unlockedAt).toBeTruthy();
  });

  it("pays less for delegated subtasks", async () => {
    const provider = new ScriptedProvider([callTool("delegate_task", { agent_id: "researcher", title: "Dig in", instructions: "Find facts" }), say(LONG), say(LONG)]);
    const h = harness(provider);
    h.store.createTask({ agentId: "manager", title: "Lead", instructions: "Delegate research", createdBy: "user" });
    await h.runner.drain();
    const rows = ledger(h.store).filter((e) => e.ref.startsWith("task:"));
    expect(rows.map((e) => e.amount).sort()).toEqual([10, 5]);
  });

  it("adds a bonus and an achievement for a delivered campaign", async () => {
    const h = harness(new ScriptedProvider([say(LONG + " brief"), say(LONG + " research"), say(LONG + " copy"), say(LONG + " review")]));
    await h.request("/api/workflows/campaign", { method: "POST", body: JSON.stringify({ topic: "Lavender latte" }) });
    await h.runner.drain();
    const rows = ledger(h.store, 50);
    expect(rows.find((e) => e.reason.startsWith("Delivered"))!.amount).toBe(25);
    expect(achievements(h.store).find((a) => a.id === "first-deliverable")!.unlockedAt).toBeTruthy();
  });
});

describe("shop", () => {
  it("refuses purchases the balance can't cover, and items that aren't for sale", async () => {
    const h = harness(new ScriptedProvider([say(LONG)]));
    const buy = (itemId: string) => h.request("/api/shop/buy", { method: "POST", body: JSON.stringify({ itemId }) });
    expect((await buy("heart-balloon")).status).toBe(409); // 0 coins
    await runTask(h, "Earn"); // 35 coins
    expect((await buy("crown")).status).toBe(409); // core items are free, not sold
    expect((await buy("heart-balloon")).status).toBe(409); // 60 > 35
    expect(coinBalance(h.store)).toBe(35);
  });

  it("requires owning a shop item before a villager can keep wearing it", async () => {
    const h = harness(new ScriptedProvider(Array.from({ length: 8 }, () => say(LONG))));
    const patch = (wearables: Record<string, string>) =>
      h.request("/api/agents/researcher", { method: "PATCH", body: JSON.stringify({ appearance: { ...h.store.getAgent("researcher")!.appearance, wearables } }) });
    expect((await patch({ head: "crown" })).status).toBe(200); // core: free
    expect((await patch({ hand: "heart-balloon" })).status).toBe(403);
    for (let i = 0; i < 4; i++) await runTask(h, `Job ${i}`); // 4×10 + 25 = 65 coins
    expect((await h.request("/api/shop/buy", { method: "POST", body: JSON.stringify({ itemId: "heart-balloon" }) })).status).toBe(200);
    expect((await patch({ hand: "heart-balloon" })).status).toBe(200);
    expect(coinBalance(h.store)).toBe(5);
    expect((await h.request("/api/shop/buy", { method: "POST", body: JSON.stringify({ itemId: "heart-balloon" }) })).status).toBe(409);
  });

  it("has no way to grant coins from the outside", async () => {
    const h = harness(new ScriptedProvider([]));
    expect((await h.request("/api/rewards", { method: "POST", body: JSON.stringify({ amount: 1000 }) })).status).toBe(404);
    expect((await h.request("/api/settings", { method: "PATCH", body: JSON.stringify({ coins: 1000 }) })).status).toBe(400);
    const snap = await (await h.request("/api/snapshot")).json();
    expect(snap.rewards.balance).toBe(0);
  });
});
