# Roadmap

## ✅ Phase 1: Foundation (this release)
- Explorable isometric pastel village (pan / rotate / zoom, overview, follow, time of day, weather)
- Three animated, clickable agents (Manager, Researcher, Copywriter) and three buildings
- Agent inspector: profile, live activity, queue, work history, configuration, task assignment
- Working Claude API integration behind a provider interface
- Real task system: priorities, dependencies, delegation, retries, cancellation, crash recovery
- Manager → Researcher → Copywriter → Manager workflow with deliverables
- Human approval center for sensitive actions
- Persistent task, event and usage logs (SQLite)
- Treasury: tokens, estimated cost, daily budget cap, Weekly Town Tax calculator
- Modular theme engine with one original theme
- Test suite (engine, approvals, permissions, failures, API security, provider request shape)

## ✅ Phase 2: Autonomy (v0.2, see [PHASE2.md](PHASE2.md))
- Separate API / worker processes with heartbeats, readiness, cross-process events and cancellation
- Docker image + two-container Compose with auto-restart; online backups
- Recurring schedules (interval / daily / weekly, timezones, DST-safe, exactly-once, catch-up once)
- Strict budgets: daily / monthly / per-task ceilings + owner limits + per-villager caps, worst case reserved before each call
- Exactly-once local tool runs across crashes
- Proof of execution (request ids, LIVE badges), connection test, `npm run verify:live`
- Hire / archive / restore villagers from templates; custom departments and buildings with new styles
- Modular skills: research, writing, delegation, coding sandbox; publishing/email placeholders; image & 3D slots

## Phase 2.5: Hardening (next)
- Run `verify:live` against a real key and fix anything it finds
- Real integrations behind approvals (email, social/blog publishing), one skill module each
- First media skill (image generation) with one provider
- Notifications outside the browser (email / push) for approvals, failures and budget holds
- Configurable permission policies per skill; approval expiry and escalation
- More workflow templates and a visual workflow builder
- Postgres implementation of `Store` for multi-host deployments

## Phase 3: Productization
- One-command installer / desktop bundle; first-run setup wizard (keys, town name, agents)
- Multi-user accounts and roles
- Theme packs: packaging format, runtime loader, signature verification, marketplace
- Ambient music and richer animation sets per theme
- Additional AI providers
- End-to-end browser tests, CI, release pipeline, licence management, documentation site
