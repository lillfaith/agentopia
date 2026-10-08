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

## Phase 2: Autonomy
- Separate `worker` process entrypoint; horizontal workers on one database
- Postgres implementation of `Store` for cloud deployments; Docker image
- Recurring schedules (daily / weekly / cron) with a scheduler and missed-run policy
- Per-agent and per-workflow spending limits; budget alerts
- Configurable permission policies per tool and agent; approval expiry and escalation
- Idempotency keys for side-effecting tools; stronger recovery semantics
- Real integrations behind approvals (email, social/blog publishing, calendars, docs)
- More workflow templates and a visual workflow builder; agent create/delete from the UI
- Notifications outside the browser (email / push)

## Phase 3: Productization
- One-command installer / desktop bundle; first-run setup wizard (keys, town name, agents)
- Multi-user accounts and roles
- Theme packs: packaging format, runtime loader, signature verification, marketplace
- Ambient music and richer animation sets per theme
- Additional AI providers
- End-to-end browser tests, CI, release pipeline, licence management, documentation site
