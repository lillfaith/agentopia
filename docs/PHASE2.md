# Phase 2: Autonomy (status report)

## 1. Audit of Phase 1 (before this phase)

| Area | Phase 1 state | Gap |
|---|---|---|
| Claude integration | Provider implemented; request shape tested against a fake transport only | Never exercised live; no record proving a call really happened; a task simulated once stayed labelled simulated |
| Task engine | Durable SQLite queue, leases, retries, dependencies, approvals, recovery | Solid foundation; kept |
| Scheduling | — | No recurring work |
| Deployment | One process; in-memory event bus | Events from another process never reached browsers; cancel only worked in-process; no container image, readiness probe or worker liveness |
| Budgets | One daily cap, checked against spend *after* calls | A single call could overshoot; over-budget tasks failed instead of waiting |
| Agents | Edit only | No hiring, archiving or building reassignment; workflow hard-coded to three agent ids |
| Buildings | Three fixed | No custom departments; walk paths only to built-in plots |
| Capabilities | Flat tool allowlist | No skill modules; no path to coding / image / 3D |

## 2. What this phase delivered

1. **Proof of execution.** Every real call records Anthropic's request id. A task is marked **LIVE** only
   when such ids exist, and shows the calls, tokens, cost and last request id. The simulator never
   produces request ids. Includes **Test connection** (Settings) and **`npm run verify:live`**: five
   capability checks plus an end-to-end agent task, each passing only on concrete evidence, capped at
   $0.50 and recorded in the database.
2. **Recurring schedules**: interval, daily or weekly, in any IANA timezone, DST-safe. Fired by the worker
   with exactly-once claims, one catch-up after downtime, overlap skipping, budget skipping, run now,
   pause, and cost projections from real runs.
3. **24/7 deployment**: `all` / `api` / `worker` roles, worker heartbeats, `/api/ready`, events streamed
   from the database, cross-process cancellation, 30-second leases, exactly-once local tool runs, `*_FILE`
   secrets, Dockerfile + Compose, and online backups.
4. **Strict budgets**: operator ceilings plus owner limits plus per-villager caps, with the worst case
   reserved before every call. Paused work waits rather than failing.
5. **Hiring**: eight role templates; hire, rename, customise, reassign, archive (history kept, queued work
   cancelled, schedules paused) and restore.
6. **Departments**: create, rename, restyle, move or demolish buildings. There are 11 plots, path tiles and
   walk routes are generated for any occupied plot, and there are three new original styles (Workshop,
   Glass Atelier, Crystal Lab).
7. **Modular skills**: one file per skill under `server/skills/`. Research (web search + fetch), writing,
   delegation and coding (Anthropic's sandbox) are real. Publishing and email are approval-gated
   placeholders. Image generation and 3D modeling are declared but **planned**: they can be attached to a
   villager but are inactive and labelled as such.
8. **The pastel village is preserved.** Existing buildings, characters, animations, lighting and weather
   are unchanged.
9. **Approvals and costs**: sensitive actions still always pause for approval. Operating costs are
   documented in [COSTS.md](COSTS.md).

## 3. What is verified, and how

| Capability | Status | Evidence |
|---|---|---|
| Task engine, schedules, budgets, hiring, departments, skills mapping, approvals | ✅ Verified | 66 automated tests (`npm test`) |
| Cross-process API/worker operation, event streaming, cancellation, recovery | ✅ Verified | Tests with two processes on one database file |
| Docker image, two-container Compose, health checks, auth refusal, crash auto-restart, graceful re-queue | ✅ Verified | Built and run in a real Docker daemon during development (simulation mode) |
| Web UI flows (hire, departments, schedules, settings, task board, approvals) | ✅ Verified | Driven in headless Chromium against the production build |
| Online backup | ✅ Verified | Run against a live database; integrity check passed |
| Claude API request format (streaming, effort, caching, fallback, web search/fetch, code execution) | ✅ Format only | Tests against a fake transport that inspects the HTTP request |
| **Live Claude API calls** (basic call, tool loop, web search, web fetch, code execution, end-to-end task) | ⏳ **Not yet verified** | No API key was available in the development environment. Run `npm run verify:live` with your key; results appear in Settings → Live verification |
| Publishing, email | 🟡 Placeholder | Approval flow verified; no external integration exists |
| Image generation, 3D modeling | 📋 Planned | Declared slots only |

## 4. Next phase (suggested)

1. Run `npm run verify:live` on a real key, then fix anything it surfaces before relying on unattended schedules.
2. Real publishing and email integrations behind the existing approval gate (one module each).
3. An image-generation skill module with one provider, which is the first media skill.
4. Notifications (email/push) for approvals waiting, failures and budget holds.
5. A Postgres store for multi-host scaling; per-user accounts.
6. Productization: installer and first-run wizard, theme-pack loader with signatures, licensing (see [ROADMAP.md](ROADMAP.md)).
