# Architecture

## 1. Reference video analysis

The reference clip is a 19-second phone recording of an Instagram Reel ("My own mini marketing agency").
The relevant footage, from about 0:06 to 0:17, is someone filming a laptop that shows a browser app on
`localhost`. It is low resolution (444×960), so small text is only partly legible.

### Visible in the video

**World & aesthetic**
- A pastel, candy-coloured 3D world seen from an angled, isometric-style perspective camera.
- A green island/meadow with a **rainbow tile path** looping through it (pink, yellow, mint, lilac, blue squares).
- Small houses on pastel square plots: red, teal, blue and yellow roofs. Also a pink dome, a large
  pink **castle** with towers and a waffle/cookie emblem on a pink circular plaza, and a cake on a stand.
- Decorations: round lollipop-style trees, red and blue **mushroom trees** with white dots, bushes, flowers,
  lollipop posts with ball tops, scattered coloured dots, a candy-cane, gift boxes, a bench.
- Characters: small round blob creatures (orange bear-like, purple/pink/blue round critters, one with a
  cap) standing on the path or working at a desk with a colourful board.

**Labels & interaction**
- Floating **name chips** above characters: an icon, role name, and level (e.g. "Director Lv10", "QA Editor Lv11", "Producer Lv11").
- Floating **speech bubbles** with the current activity ("Checking B2C home-decor segment", "boba break",
  "Review with Min", "Run sheet: Dad session", "Planning Shorts / Reels / TikTok cuts", "treat from Gelato").
- A cursor clicks on the world. A character inspector panel opens on the right.

**Top bar / HUD**
- Top-left status card: studio name and subtitle ("Min's Studio · 4 brands") plus counters:
  agents, working, waiting, talking, errors, tasks, **XP**, **LIVE**, and a "DEMO SIM on" toggle.
- Top toolbar: time-of-day buttons (sun, partly cloudy, sunset, moon), **Freeze view**, **Names**,
  **Bubbles**, **Log**, **God view**, **Dashboard**.
- Left panel: **Global status** (Online, Working, Idle, Waiting, Errors, Active tasks),
  **Performance (this session)** (tasks done, success rate, avg duration, team busy, est. time saved, XP earned,
  plus a note that token and cost usage aren't exposed), and a **Studio board** with per-brand progress bars and
  task rows tagged EDIT / BRIEF / IDEA.
- Bottom: a dock of colourful rounded icon buttons.

**Agent inspector** (Producer): avatar, role ("Producer / Traffic"), level badge, status chip ("working"),
XP progress bar, stat tiles (XP, Skill, Productivity %, Badges), **Working on** (task title + progress bar),
**Live activity** (step list), **Tools** (e.g. "Write"), a **Stop task** button with a note that it's a demo task,
a "Studio board" section, and a "Message Producer…" input.

**Execution log**: a table with filters (All / Live / Demo, all agents, all brands, search). Rows show a time,
agent, an action badge (**STEP / SEND / DONE / START**) and a message such as "Sent PASS → Post-Producer",
"Finished: Script…", "Waiting for footage from brother". Its footer points at a local `events.jsonl` and `board.json`.

### Not visible (we designed it ourselves)

- How agents actually execute: the clip shows "DEMO SIM on", so at least some activity there is simulated.
- Any backend, persistence, scheduling, retries, approvals, permissions, cost tracking (the clip explicitly
  says token/cost usage isn't exposed), API key handling or multi-user security.
- Theme swapping, installation and distribution.

### What we kept and what we changed

| From the video | In Agentopia |
|---|---|
| Pastel isometric town, rainbow path, mushroom trees, blob villagers | Original **Pastel Village** theme with the same mood; all assets new and built from primitives |
| Name chips with level, activity bubbles, Names/Bubbles toggles | Same, but bubble text is the agent's **real latest step**; levels derive from real completed tasks |
| Time-of-day buttons, overview ("God view") | Dawn/Day/Dusk/Night presets per theme; **Overview** fly-to; **Follow** camera |
| Status card counters, LIVE indicator | Same, plus estimated spend; LIVE reflects the real SSE connection |
| Inspector with working-on, live activity, tools, stop, message box | Same, plus queue, completed work with outputs, full configuration, and task assignment |
| Execution log with START/STEP/SEND/DONE | Same badge language, backed by the persisted `events` table |
| "DEMO SIM" mixed with real work | Simulation is **opt-in**, **only when no key is set**, and flagged on every output, event, task and banner |
| No cost visibility | Treasury: tokens and estimated cost per call, agent, model and day, plus a daily budget cap |

## 2. Recommended architecture (and why)

**Goals:** real agent work verifiable end to end; runs 24/7 without a browser; swappable visuals; installable by customers with their own keys.

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript everywhere | One language for the 3D client, server and shared types |
| 3D | React Three Fiber + drei | Declarative scene graph that maps naturally to "theme components" |
| Server | Node 22 + Hono | Small, fast, built-in SSE streaming, easy in-process testing (`app.request`) |
| Storage | SQLite via built-in `node:sqlite` | Zero native dependencies for installers; WAL mode; migration-tracked; replaceable by Postgres behind `Store` |
| Queue | The database itself (lease-based claims) | Durable without Redis; survives restarts; multiple worker processes can share it |
| Live updates | Server-Sent Events | One-way server→client stream is all we need; resumable with `Last-Event-ID` |
| AI | `@anthropic-ai/sdk` behind an `LLMProvider` interface | Real Claude integration now, more providers later without touching the executor |
| Agent loop | Manual tool-use loop | Every step is logged, costed, approval-gated and persisted between turns |

### Smallest viable implementation (Phase 1 scope)

One process runs the API, the worker and (in production) static hosting. Three seeded agents, three
buildings, one workflow template, four tools (two real, two approval-gated placeholders), one theme.
Everything is persisted so the same code can later be split into separate API and worker processes.

## 3. Backend

```
server/
  index.ts           entry: config → app → HTTP server; graceful shutdown re-queues running tasks
  app.ts             composition root (store, provider selection, runner, API)
  config.ts          env parsing; refuses non-loopback binding without an admin token
  db/database.ts     node:sqlite, WAL, PRAGMA user_version migrations
  db/store.ts        the only persistence gateway; every change can emit an event
  llm/provider.ts    provider-neutral interface (opaque provider-native messages)
  llm/anthropic.ts   Claude: streaming, effort, cached system prompt, refusal fallback, hosted web search
  llm/simulated.ts   opt-in offline simulator (exercises the same code paths, flagged everywhere)
  llm/models.ts      model list + list prices (single place to update pricing)
  agents/seed.ts     Town Hall / Observatory / Inkwell Studio; Mabel / Pip / Quill
  agents/tools.ts    tool registry: sensitivity, schema (zod), real vs placeholder
  agents/prompt.ts   stable system prompt (cache-friendly) + brief with colleague outputs
  engine/runner.ts   worker: claim → execute → finalize; retries, dependencies, approvals, cancel
  engine/executor.ts per-task tool-use loop, approval gate, usage + budget
  engine/workflows.ts Manager → Researcher → Copywriter → Manager template
  engine/treasury.ts aggregates + Weekly Town Tax calculator
  api/routes.ts      REST + SSE, validation, auth, host/origin checks
```

### Task life cycle

```
            createTask (deps pending?) ──yes──▶ blocked ──(all deps completed)──▶ queued
                                       └─no──▶ queued
queued ──claim (lease 60s, heartbeat)──▶ running ──▶ completed ──▶ unblock dependents + handoff events
                                            │
                                            ├──▶ waiting_approval ──(all approvals decided)──▶ queued (resumes)
                                            ├──▶ retry_wait (transient error, exp. backoff) ──▶ queued
                                            └──▶ failed (non-retryable / attempts exhausted) ──▶ dependents fail
cancel (any non-terminal) ──▶ cancelled ──▶ dependents cancelled
```

- **One task per agent at a time**: the claim query skips agents that already have a running task, matching
  the one-villager-one-job metaphor. Ordering is priority, then FIFO.
- **Crash recovery**: expired leases go back to `queued` on boot and on every poll.
- **Resumable transcripts**: `tasks.conversation` stores the provider transcript and pending tool calls.
  The transcript is append-only. Assistant turns are stored exactly as returned, and tool results are
  appended. So a task resumes after an approval pause, a retry or a restart without editing history.
- **Approval safety**: in a turn with sensitive tool calls, no tool runs until every sensitive call in that
  turn is decided, so nothing executes twice on resume.

### Events → the world

Every state change writes an event (`task.started`, `task.step`, `task.tool_call`, `task.handoff`,
`task.approval_requested`, `agent.status`, `usage.recorded`, …). The SSE stream pushes them to the
client, which:

- updates agent status → animation state and where the villager stands (busy → at its building, idle → wanders);
- turns `task.handoff` (`fromAgentId → toAgentId`) into an **errand**: the villager walks to the
  recipient's building with a scroll, pauses, then walks back;
- uses the latest `task.step` / `task.tool_call` text as the speech bubble;
- refreshes the snapshot (debounced) for tasks, approvals and stats.

### Data model (SQLite)

`agents`, `buildings`, `tasks`, `workflows`, `approvals`, `events`, `usage`, `settings`. See
`server/db/database.ts` for the schema. Shared TypeScript types live in `shared/types.ts`.

## 4. Frontend

```
web/src/
  theme-engine/   ThemeManifest contract, registry, ThemeProvider (applies CSS variables)
  themes/         built-in theme packs (pastel-village)
  world/          World (scene composition), AgentActor (movement from real state), CameraRig, nav routing, WorldLabel
  ui/             HUD, inspector, panels, treasury, settings, styles (all colours via theme CSS variables)
  state/store.ts  zustand: snapshot + live events + UI state
  api/client.ts   fetch wrapper (bearer token) + fetch-based SSE with resume
```

The world asks the theme where each building **slot** is (`north`, `west`, `east`, …) and how to draw
each building **kind** (`hq`, `research`, `studio`, or a generic fallback). Agents keep their data; only
the look changes.

## 5. Phase 2 additions

- **Skills** (`server/skills/`): `capabilitiesFor(agent)` turns an agent's skill ids into local tools, hosted
  tools and stable prompt guidance. When the coding skill is combined with web research, the provider
  switches to the basic web-tool versions so the model sees a single code sandbox.
- **Scheduler** (`server/engine/scheduler.ts`): pure, dependency-free timezone math (`Intl`) and a
  `tick()` that runs inside the worker's poll. Due occurrences are claimed by compare-and-set on `next_run_at`.
- **Budgets** (`server/engine/budget.ts`): `preflight()` before every call. Global holds stop claiming,
  per-agent holds exclude those agents from claims, and the executor returns `budget_hold`, which the
  runner turns into a delayed re-queue.
- **Roles and cross-process operation**: `AGENTOPIA_ROLE` decides whether a process serves HTTP, runs the
  worker, or both. SSE tails the `events` table. Cancellation is a database state that the worker's lease
  heartbeat notices. `workers` holds heartbeats; `tool_runs` makes local tool calls exactly-once.
- **Proof of execution**: `usage.request_id` / `requested_model`. `Task.execution` is derived from usage rows.
- **Verification** (`server/engine/verify.ts`): live checks shared by the API's connection test and `scripts/verify-live.ts`.

## 6. Path to multi-host cloud operation

Single-host 24/7 operation is in place (see [DEPLOYMENT.md](DEPLOYMENT.md)). Going multi-host requires
a Postgres implementation of `Store` (the claim, compare-and-set and tail queries map directly onto it) and
moving SSE tailing to `LISTEN/NOTIFY`. See [ROADMAP.md](ROADMAP.md).
