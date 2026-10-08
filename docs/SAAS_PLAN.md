# Agentopia SaaS: audit and implementation plan

Status legend used throughout: **Real** (implemented and tested), **Placeholder** (records intent,
contacts no external system), **Simulated** (fake data, labelled in the UI), **Missing**.

## Phase 1: Audit

### 1. Technology stack
| Layer | What is used | Notes |
|---|---|---|
| Frontend | React 19, @react-three/fiber 9 + drei 10 (three 0.186), zustand 5, Vite 8, TypeScript | 3D town, HUD, panels; theme engine (`web/src/theme-engine`) |
| Backend | Node 22, Hono 4 (`@hono/node-server`), zod 4 | One process can be API, worker, or both (`AGENTOPIA_ROLE`) |
| Database | SQLite via built-in `node:sqlite`, WAL mode | Zero native deps; migrations via `PRAGMA user_version` |
| AI | `@anthropic-ai/sdk` (streaming, effort, prompt caching, refusal fallback, hosted web search/fetch/code execution) | Behind a provider interface (`server/llm/provider.ts`) |
| Real time | Server-Sent Events that tail the `events` table | Works across processes; resumable with `Last-Event-ID` |
| Tests | vitest (98 tests), Playwright scripts for screenshots | `npm test`, `npm run typecheck` |
| Deploy | Dockerfile (one image, three roles), docker-compose (API + worker), GitHub Action for live API verification | No hosted deployment yet |

### 2. Database schema and migrations
Single SQLite file, 4 migrations applied in order and tracked by `PRAGMA user_version`
(`server/db/database.ts`). Tables: `settings`, `buildings`, `agents`, `workflows`, `tasks`,
`approvals`, `events`, `usage`, `schedules`, `workers`, `tool_runs`, `verifications`.
All access goes through one gateway class, `Store` (`server/db/store.ts`).
**Gap:** there is no notion of a user or tenant anywhere in the schema.

### 3. Authentication
**Single shared admin token** (`AGENTOPIA_ADMIN_TOKEN`), compared in constant time, plus host-header
(DNS rebinding) and JSON/Origin (CSRF) checks. Without a token the server only accepts loopback.
**Missing:** user accounts, passwords, sessions, per-user authorization, account isolation.

### 4. Which agent actions execute real AI requests
**Real:** every task run by the worker calls Claude through `AnthropicProvider` when
`ANTHROPIC_API_KEY` is set. This includes one-off tasks, campaign workflows (brief → research → copy →
review), delegated tasks, scheduled runs, web search/fetch and sandboxed code execution. Each call stores
its Anthropic `request_id`. A live check passed in GitHub Actions (6/6 checks, about $0.11).

### 5. Simulated or placeholder features
| Feature | State |
|---|---|
| `AGENTOPIA_SIMULATION=true` provider | **Simulated**, only when explicitly enabled and no key is set; labelled everywhere |
| Static demo build (`npm run build:demo`) | **Simulated**: replays a recorded session in the browser |
| `publish_content`, `send_email` tools | **Placeholder**: approval works, nothing is sent |
| Image generation, 3D modelling skills | **Planned**: contribute no tools |
| Weekly Town Tax | Calculator only, never moves money |
| Levels/XP | Cosmetic, derived from real completed tasks |
| Coins, purchases, subscriptions, billing | **Missing** |
| Agent long-term memory | **Missing** (agents see only the task brief and colleague outputs) |

### 6. Persistence and real time
**Real:** everything is persisted (agents, looks, tasks, transcripts, approvals, events, usage,
schedules). The task queue lives in the database: lease-based claims, heartbeats, crash recovery,
retries with backoff, dependencies, approvals that pause and resume, cancellation noticed across
processes, and exactly-once local tool calls (`tool_runs`). The browser updates over SSE.

### 7. Security review
Already good: secrets never reach the browser; least-privilege tools; zod validation; mandatory human
approval for sensitive tools; hard budget ceilings with per-call worst-case reservation; no shell or
filesystem tools; markdown rendered without raw HTML.
Missing for a multi-user SaaS:
1. No user accounts or isolation (the critical gap).
2. No login rate limiting or session management.
3. No per-user spending limits tied to a plan.
4. No emergency stop.
5. No audit log of account actions.
6. Operator-level budgets are global, so one user could exhaust everyone's budget.
7. No email verification or password reset (needs an email provider).
8. No structured production logging or error reporting.

### 8. What production needs
Accounts and sessions; per-user isolation; per-plan entitlements enforced on the server; a background
worker serving all users; Stripe billing with verified webhooks; TLS (the host provides it); backups;
health checks; logging and error monitoring; documented environment variables; end-to-end tests.

### 9. Simplest compatible hosting
**One Railway service** running the existing Docker image with `AGENTOPIA_ROLE=all`, plus a
**Railway volume** at `/data`. One container serves the web app and API and runs the worker. Railway
terminates TLS. This needs no new infrastructure.

## Key architecture decision: one database file per user

Each user's world lives in **its own SQLite file** (`/data/towns/<townId>.sqlite`) with the existing
schema. A small central `accounts.sqlite` holds users, sessions, the town registry, entitlements,
billing state and an audit log.

Why this rather than adding `user_id` to every table, or moving to Postgres now:
- **Isolation holds by construction.** A request is routed to the logged-in user's town file before
  any query runs, so no query can see another user's rows, even with a bug in a `WHERE` clause.
- **Reuse.** `Store`, every API route, the executor, the queue, approvals, budgets and schedules run
  unchanged, one instance per town.
- **Operations.** Per-user backup, export and deletion are just file operations.

Trade-offs: a single volume, so one container (fine for thousands of users, since agent runs wait on
the AI API rather than the CPU). There are no cross-user SQL queries (analytics read the accounts
database). The documented scale-out path is Postgres with a `town_id` on every table behind the same
`Store` interface, or one schema per tenant.

**Supabase:** not needed now. Auth is a small, testable module here. Postgres becomes useful only for
multi-instance scale-out; Supabase is a reasonable managed choice then.
**Trigger.dev:** redundant today. The existing queue already provides durable runs, retries with
limits, idempotent tool calls, cancellation, timeouts, schedules, concurrency limits and history. It
would add a second source of truth for task state. Reconsider if runs need to scale far beyond one
container.

## Implementation plan (in order of importance)

1. **Vertical slice:**
   - Accounts with email + password, secure sessions and login rate limiting.
   - A private town per user, with requests routed to it.
   - A worker pool that runs every user's queue in the background, waking only for towns that have work.
   - Projects: create one, assign tasks within it.
   - A login screen in the existing style.
   - Tests for isolation and persistence, plus a **live end-to-end test against the real Claude API in
     GitHub Actions**.
2. **Safety:**
   - Plan-based per-user spending limits and model allowlists.
   - A visible emergency stop: pause all agents and cancel running tasks.
   - Account audit log.
   - Prompt-injection hardening for web content.
3. **Billing:**
   - Stripe Checkout and the billing portal.
   - Verified webhooks (subscription created, updated, deleted, payment failed).
   - Entitlements derived on the server only, with grace periods and downgrades.
4. **Gamification:**
   - A coin ledger with idempotent rewards keyed by event.
   - Rewards only for verified completions, with anti-farming rules (minimum real work, daily caps,
     no rewards for cancelled, failed or trivially short tasks) and no self-reported revenue.
   - A cosmetics shop. Coins have no cash value.
5. **Agent memory:**
   - Per-agent memory notes the agent writes through a tool and that are injected into later briefs.
   - Notes are size-capped, user-visible and deletable.
6. **Production:**
   - Railway config, environment variable reference, migration command and health checks.
   - Structured JSON logs, an error-reporting hook, backups of every town file, a deployment checklist
     and CI end-to-end tests.

Remaining placeholders stay labelled until a real integration replaces them: email sending, publishing,
image and 3D generation.

## Progress

| Step | State | Evidence |
|---|---|---|
| 1. Vertical slice | **Done** | `tests/saas.test.ts` (auth, isolation, background run, restart persistence, idle close and wake, plan hold); `npm run e2e:live` against the real Claude API in the `e2e-live` workflow |
| 2. Safety | Next | |
| 3–6 | Planned | |

Run it locally: `npm run dev:saas` (add `AGENTOPIA_SIMULATION=true` to try it without an API key), then open http://127.0.0.1:5173 and create an account.
