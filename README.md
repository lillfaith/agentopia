# 🏡 Agentopia

**An isometric AI town where every villager is a real, configurable AI employee.**

Agentopia turns managing autonomous AI agents into a cosy life-simulation game. Each round little
villager is a working agent with its own system prompt, model, tools, task queue, activity history
and cost ledger. When the Manager hands research to the Researcher, you watch her walk the brief
across town. That walk happens because the hand-off happened in the database. Nothing on screen is
faked progress.

![The village by day: Mabel, Pip and Quill handing work to each other](docs/images/village-handoff.jpg)
![Night: Quill waits for approval before publishing](docs/images/night-approval.jpg)

<sub>Screenshots from the offline simulation mode (hence the banner). With an API key, the same flow runs on Claude.</sub>

> **Status: Phase 1 (Foundation).** A working local prototype. See [What is real vs. placeholder](#what-is-real-vs-placeholder)
> and the [roadmap](docs/ROADMAP.md).

---

## Quick start

Requirements: **Node.js ≥ 22.13** (it uses the built-in `node:sqlite`, so there is no native build step).

```bash
git clone <this repo> agentopia && cd agentopia
npm install
cp .env.example .env          # then put your key in ANTHROPIC_API_KEY=...
npm run dev                   # API on :8787, web client on http://127.0.0.1:5173
```

Open **http://127.0.0.1:5173**, click **✨ New project**, describe a product, and watch
Mabel (Manager) → Pip (Researcher) → Quill (Copywriter) → Mabel (review) produce a finished
deliverable. It shows up under **🎁 Deliverables**.

**No API key yet?** Set `AGENTOPIA_SIMULATION=true` in `.env` to explore the town offline. Simulated
work is marked `[SIMULATED OUTPUT]` and `SIMULATED` everywhere, costs $0, and never calls a model.
A real key always takes precedence over simulation.

Production-style single process (serves the built client too):

```bash
npm run build && npm start    # http://127.0.0.1:8787
```

| Script | What it does |
|---|---|
| `npm run dev` | API server (auto-reload) + Vite dev client |
| `npm run build` | Build the web client into `dist/web` |
| `npm start` | Run the server in production mode, serving `dist/web` |
| `npm test` | Vitest suite: engine, approvals, permissions, retries, budget, API security, provider request shape |
| `npm run typecheck` | TypeScript across server, client and tests |

Full setup, cloud notes and troubleshooting: **[docs/INSTALL.md](docs/INSTALL.md)**.

---

## What you can do

- **Explore the village.** Drag to pan, right-drag to rotate, scroll to zoom. Use 🗺️ Overview to fly back,
  🎯 Follow to track a villager, and switch between dawn, day, dusk and night.
- **Click a villager** to open the inspector: profile, level (derived from completed tasks), what
  they're doing *right now* (live steps), their queue, completed work with outputs, a Stop button, and
  a full **Configure** tab for name, role, personality, system prompt, model, effort, authorised tools,
  colour and accessory.
- **Click a building** to see who works there and its recent work.
- **Assign tasks** from the inspector or the 📋 Task board, with priority and an optional dependency.
  The dependency's output is passed in automatically.
- **Start a project** (✨): a four-step Manager → Researcher → Copywriter → Manager workflow.
- **Approve or reject** sensitive actions in 🔔 Approvals. Publishing, external messages, spending,
  deploys and destructive actions always stop here.
- **Watch the 📜 Execution log** (START / STEP / TOOL / SEND / DONE …) and **💰 Treasury**: tokens and
  estimated cost per agent, per model and per day, today's budget, and the optional Conservation Center
  (Weekly Town Tax pledge calculator).

---

## What is real vs. placeholder

| Capability | Status |
|---|---|
| Claude API calls (streaming, adaptive thinking via `effort`, prompt caching, server-side refusal fallback) | **Real.** Request shape is covered by tests with a fake transport. A live call needs your key. |
| Web search for the Researcher (Claude's hosted `web_search` tool) | **Real** (billed per search by Anthropic) |
| Task queue, priorities, dependencies, retries with backoff, crash recovery, cancellation | **Real**, persisted in SQLite |
| Agent-to-agent delegation (`delegate_task` tool) and workflow hand-offs | **Real** |
| Human approval gate for sensitive tools | **Real**; tasks pause and resume from the saved transcript |
| `publish_content`, `send_email` tools | **Placeholder.** On approval they record intent and post/send **nothing** (no integrations yet) |
| Token and cost tracking | **Real tokens**, **estimated dollars** (list prices in `server/llm/models.ts`) |
| Weekly Town Tax | **Calculator only.** Never charges or donates money |
| Agent levels / XP | **Cosmetic**, derived only from completed tasks |
| Offline simulation provider | **Opt-in demo/testing aid**; clearly flagged, never presented as real work |
| Ambient music | **Not included** (the theme slot exists; sound effects are procedural) |
| Recurring schedules, multi-worker cloud deployment, spending policies | **Phase 2**: the architecture is ready (see roadmap) |

---

## Architecture at a glance

```
┌──────────── web (React + React Three Fiber) ────────────┐      ┌──────────────── server (Node + Hono) ────────────────┐
│ theme-engine/  ← contract: Environment/Building/         │      │ api/routes.ts   REST + SSE (/api/stream), auth, CSRF │
│                  Character components, layout, lighting, │ HTTP │ engine/runner   durable queue: leases, retries,      │
│                  UI CSS vars, sfx                        │◀────▶│                 dependencies, approvals, recovery    │
│ themes/pastel-village/   (the only theme in Phase 1)     │ SSE  │ engine/executor manual tool-use loop per agent,      │
│ world/   actors move ONLY on real status + hand-offs     │      │                 append-only transcripts, cost/budget │
│ ui/      HUD, inspector, board, log, approvals, treasury │      │ agents/         seed agents, tool registry, prompts  │
│ state/   zustand store fed by snapshot + live events     │      │ llm/            provider interface, Anthropic, sim   │
└──────────────────────────────────────────────────────────┘      │ db/             SQLite store + migrations            │
                                                                  └──────────────────────────────────────────────────────┘
```

The backend is the source of truth and runs tasks without a browser open. The client only renders
state and sends commands. Themes are pure presentation: they receive theme-agnostic data (an avatar
colour, an accessory keyword, an animation state, a building "kind") and can be swapped without
touching agents, tasks or data.

More detail:
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): reference-video analysis, design decisions, data model, event flow
- [docs/THEMES.md](docs/THEMES.md): how to build a theme pack
- [docs/SECURITY.md](docs/SECURITY.md): key handling, tool permissions, approvals, network exposure
- [docs/ROADMAP.md](docs/ROADMAP.md): Phase 2 (autonomy) and Phase 3 (productization)

---

## Licence & assets

All 3D assets are original and built from primitives in code. No third-party characters or artwork are used.
Licence: proprietary / UNLICENSED for now (commercial product in development).
