#!/usr/bin/env node
// Usage: start a server with AGENTOPIA_SIMULATION=true and no API key on :8787 (fresh database), then
//   node scripts/record-demo.mjs web/src/demo/fixture.json
// Records a simulated work session from a running Agentopia server (simulation mode, no AI calls)
// into a replay fixture for the static demo build.
import { writeFileSync } from "node:fs";
const base = process.env.AGENTOPIA_URL ?? "http://127.0.0.1:8787";
const get = (p) => fetch(base + p).then((r) => r.json());
const send = (m, p, b) => fetch(base + p, { method: m, headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
const out = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Town setup: the seeded trio plus one extra department, and a couple of cute outfits.
await send("POST", "/api/buildings", { name: "Engineering Workshop", department: "Engineering", kind: "workshop", slot: "south", description: "Home of the Engineering department." });
await send("PATCH", "/api/agents/manager", { appearance: { bodyColor: "#f59ab8", accentColor: "#ffe3ec", cheekColor: "#ff7fa8", eyes: "sparkle", expression: "smile", ears: "cat", tail: "puff", size: 1.05, wearables: { head: "tiara", neck: "pearls" } } });
await sleep(800);
const initial = await get("/api/snapshot");
const t0 = Date.now();
const frames = [];
let lastEventId = initial.events.length ? initial.events[initial.events.length - 1].id : 0;
let lastKey = "";
const strip = (s) => ({ agents: s.agents, stats: s.stats, tasks: s.tasks, approvals: s.approvals, workflows: s.workflows });

const kick = async (topic, audience) => send("POST", "/api/workflows/campaign", { topic, audience });
await sleep(1500);
await kick("Lavender oat milk launch", "students and young professionals");
let doneAt = 0;
let second = false;
while (Date.now() - t0 < 240_000) {
  const s = await get("/api/snapshot");
  const events = s.events.filter((e) => e.id > lastEventId);
  if (events.length) lastEventId = events[events.length - 1].id;
  for (const a of s.approvals.filter((x) => x.status === "pending")) {
    // Approve after a short, visible wait so the "waiting for approval" state shows up.
    if (Date.now() - new Date(a.createdAt).getTime() > 6000) await send("POST", `/api/approvals/${a.id}/decide`, { approve: true, note: "Looks lovely!" });
  }
  const st = strip(s);
  const key = JSON.stringify(st);
  if (events.length || key !== lastKey) {
    frames.push({ t: Date.now() - t0, events, ...st });
    lastKey = key;
  }
  const busy = s.agents.some((a) => a.status !== "idle") || s.workflows.some((w) => w.status === "running");
  if (!busy && frames.length > 5) {
    if (!second) {
      second = true;
      await sleep(4000);
      await kick("Cherry blossom tea café opening", "local families");
    } else if (!doneAt) doneAt = Date.now();
    else if (Date.now() - doneAt > 3000) break;
  }
  await sleep(300);
}
const treasury = await get("/api/treasury");
writeFileSync(out, JSON.stringify({ recordedAt: new Date(t0).toISOString(), initial, frames, treasury }));
console.log("frames", frames.length, "duration", frames.at(-1).t, "events", frames.reduce((n, f) => n + f.events.length, 0));
