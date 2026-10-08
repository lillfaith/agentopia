import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { WEARABLES, WEARABLE_SLOTS, defaultAppearance, normalizeAppearance, normalizeVoice } from "../shared/cosmetics.js";
import { buildSystemPrompt } from "../server/agents/prompt.js";
import { capabilitiesFor } from "../server/skills/index.js";
import { MIGRATIONS, openDatabase } from "../server/db/database.js";
import { harness, say, ScriptedProvider } from "./helpers.js";

const look = {
  bodyColor: "#a7e8bd",
  accentColor: "#effff4",
  cheekColor: "#ff9fb8",
  eyes: "sparkle",
  expression: "grin",
  ears: "bunny",
  tail: "fox",
  size: 1.1,
  wearables: { head: "sun-hat", eyes: "star-shades", neck: "flower-lei", back: "fairy-wings", hand: "coffee" },
};

describe("cosmetic catalog", () => {
  it("ships at least 12 original items covering every slot, with unique ids", () => {
    expect(WEARABLES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(WEARABLES.map((w) => w.id)).size).toBe(WEARABLES.length);
    for (const slot of WEARABLE_SLOTS) expect(WEARABLES.some((w) => w.slot === slot)).toBe(true);
    for (const name of ["bow", "hat", "crown", "glasses", "scarf", "flower", "headphones", "backpack"]) {
      expect(WEARABLES.some((w) => w.name.toLowerCase().includes(name) || w.id.includes(name))).toBe(true);
    }
  });

  it("normalizes stored data: drops unknown or mis-slotted items, clamps values", () => {
    const n = normalizeAppearance({ ...look, size: 9, eyes: "laser", wearables: { head: "coffee", hand: "nope", neck: "scarf" } });
    expect(n.size).toBe(1.2);
    expect(n.eyes).toBe("round");
    expect(n.wearables).toEqual({ neck: "scarf" });
    expect(normalizeVoice({ preset: "robotic", pitch: 40, speed: 0.1 })).toMatchObject({ preset: "robotic", pitch: 12, speed: 0.5 });
  });
});

describe("cosmetics are purely visual", () => {
  it("never changes the system prompt, the tools offered, or anything sent to the model", () => {
    const h = harness(new ScriptedProvider([]));
    const before = h.store.getAgent("researcher")!;
    const promptBefore = buildSystemPrompt(before, capabilitiesFor(h.store, before).prompts);
    const toolsBefore = JSON.stringify(capabilitiesFor(h.store, before));
    h.store.updateAgent("researcher", { appearance: look as never, voice: { preset: "robotic", pitch: -5, speed: 1.5, tone: 0.9, texture: 0.8 } });
    const after = h.store.getAgent("researcher")!;
    expect(after.appearance).toMatchObject({ ears: "bunny", wearables: { hand: "coffee" } });
    expect(buildSystemPrompt(after, capabilitiesFor(h.store, after).prompts)).toBe(promptBefore);
    expect(JSON.stringify(capabilitiesFor(h.store, after))).toBe(toolsBefore);
    expect(promptBefore).not.toMatch(/sun-hat|wings|bunny|robotic/);
  });

  it("changes outfits mid-task without interrupting or altering the task", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const provider = new ScriptedProvider([async () => (await gate, { text: "finished" })]);
    const h = harness(provider);
    const t = h.store.createTask({ agentId: "copywriter", title: "Long", instructions: "x", createdBy: "user" });
    await h.runner.tick();
    expect(h.store.getTask(t.id)!.status).toBe("running");
    const statusBefore = h.store.getAgent("copywriter")!.status;
    const res = await h.request("/api/agents/copywriter", { method: "PATCH", body: JSON.stringify({ appearance: look, voice: { preset: "sleepy", pitch: -3, speed: 0.8, tone: 0.3, texture: 0.4 } }) });
    expect(res.status).toBe(200);
    expect(h.store.getTask(t.id)!.status).toBe("running");
    expect(h.store.getAgent("copywriter")!.status).toBe(statusBefore);
    release();
    await h.runner.drain();
    expect(h.store.getTask(t.id)).toMatchObject({ status: "completed", output: "finished" });
    expect(provider.calls[0].system).not.toMatch(/sun-hat|sleepy/);
    const ev = h.store.listEvents({ limit: 100 }).find((e) => e.type === "agent.updated")!;
    expect(ev.data).toMatchObject({ cosmetic: true });
  });

  it("validates appearance and voice through the API", async () => {
    const h = harness(new ScriptedProvider([]));
    const bad = (body: unknown) => h.request("/api/agents/manager", { method: "PATCH", body: JSON.stringify(body) });
    expect((await bad({ appearance: { ...look, wearables: { head: "coffee" } } })).status).toBe(400); // wrong slot
    expect((await bad({ appearance: { ...look, wearables: { head: "jetpack" } } })).status).toBe(400); // unknown item
    expect((await bad({ appearance: { ...look, ears: "wings" } })).status).toBe(400);
    expect((await bad({ voice: { preset: "opera", pitch: 0, speed: 1, tone: 0.5, texture: 0 } })).status).toBe(400);
    expect((await bad({ appearance: look })).status).toBe(200);
  });

  it("persists across restarts and seeds the founders with distinct looks and voices", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentopia-look-"));
    const dbPath = path.join(dir, "t.sqlite");
    const a = harness(new ScriptedProvider([]), { dbPath });
    const voices = a.store.listAgents().map((x) => x.voice.preset);
    expect(new Set(voices).size).toBe(3);
    a.store.updateAgent("manager", { name: "Mabel II", appearance: look as never });
    a.db.close();
    const b = harness(new ScriptedProvider([]), { dbPath });
    expect(b.store.getAgent("manager")).toMatchObject({ name: "Mabel II", appearance: { tail: "fox", wearables: { back: "fairy-wings" } } });
    b.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("migrates Phase 2 avatars (colour + accessory) into full appearances", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentopia-mig-"));
    const dbPath = path.join(dir, "t.sqlite");
    const raw = new DatabaseSync(dbPath);
    for (let i = 0; i < 3; i++) {
      const m = MIGRATIONS[i];
      if (typeof m === "string") raw.exec(m);
      else m(raw);
    }
    raw.exec("PRAGMA user_version = 3");
    raw.exec(`INSERT INTO buildings (id, name, department, kind, slot) VALUES ('h', 'H', 'D', 'hq', 'north')`);
    raw.exec(`INSERT INTO agents (id, name, role, system_prompt, model, avatar, building_id, created_at, updated_at)
              VALUES ('bolt', 'Bolt', 'Engineer', 'p', 'claude-opus-5-5', '{"color":"#a7e8bd","accessory":"goggles"}', 'h', 'x', 'x')`);
    raw.close();
    const db = openDatabase(dbPath);
    const row = db.prepare("SELECT appearance, voice FROM agents WHERE id = 'bolt'").get() as { appearance: string; voice: string };
    expect(JSON.parse(row.appearance)).toMatchObject({ bodyColor: "#a7e8bd", wearables: { eyes: "goggles" } });
    expect(JSON.parse(row.voice).preset).toBe("bubbly");
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    expect(defaultAppearance("#123456").accentColor).not.toBe("#123456");
  });
});
