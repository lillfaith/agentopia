# 24/7 deployment

Agentopia runs its work on the **server**. Once deployed, villagers keep working through queued tasks
and schedules with every browser closed.

## Process roles

One codebase and one image run in three roles, chosen with `AGENTOPIA_ROLE`:

| Role | Runs | Use |
|---|---|---|
| `all` (default) | HTTP API + web client + worker + scheduler | Laptop / single small server |
| `api` | HTTP API + web client only | Public-facing container |
| `worker` | Task queue + scheduler only, no HTTP | Background container(s) |

All roles share one SQLite database (WAL mode). Workers claim tasks with leases inside `BEGIN IMMEDIATE`
transactions, and schedules fire through a compare-and-set on `next_run_at`, so several workers on the
same host never double-run a task or a schedule occurrence. Events are tailed from the database, so the
browser sees work done by any worker process.

## Docker Compose (recommended)

```bash
mkdir -p secrets
printf '%s' 'sk-ant-…' > secrets/anthropic_api_key
openssl rand -hex 32   > secrets/admin_token
docker compose up -d --build
docker compose ps                # both services should become "healthy"
```

- `api` listens on `127.0.0.1:8787`. Put a TLS reverse proxy (Caddy, nginx, a cloud load balancer) in front of it.
- `worker` has no ports.
- Both use `restart: unless-stopped` and a healthcheck: HTTP for the API, a fresh heartbeat in the database for the worker.
- Secrets are read from files (`ANTHROPIC_API_KEY_FILE`, `AGENTOPIA_ADMIN_TOKEN_FILE`), never baked into the image.
- The container **refuses to start** on a public interface without an admin token.
- Hard budget ceilings are set in `docker-compose.yml`. The owner can only lower them in the UI.

## Recovery behaviour (tested)

These scenarios were exercised against the real containers during development:

| Event | What happens |
|---|---|
| Worker process crashes (SIGKILL) | Docker restarts it. The task it held is re-queued once its 30-second lease lapses, and resumes from its saved transcript on the next attempt. |
| Graceful stop / redeploy (SIGTERM) | In-flight tasks go straight back to the queue without using up a retry attempt, and resume on restart. |
| Worker down while schedules are due | Each schedule fires **once** when a worker returns, not once per missed slot. |
| API container down | Workers keep running. Events are stored and replayed to browsers when they reconnect. |
| Budget limit reached | Nothing new starts. Queued work waits for the reset and schedules skip. |
| A task is cancelled from the UI while running in another process | The worker notices within about 2 seconds and stops it. |

Local tool calls (e.g. delegation) are recorded the moment they run, so a crash-recovered task never
repeats a side effect. Hosted tools (web search, code execution) run on Anthropic's side, so a call that
was interrupted mid-flight may be repeated and billed again on retry.

## Monitoring

- `GET /api/health` returns liveness (no auth).
- `GET /api/ready` returns 200 only if the database is reachable and (for `all`/`worker`) a worker heartbeat is fresh (no auth).
- **Settings → Workers** lists every worker process with its host, pid and last heartbeat.
- The top bar shows **⚙️ no worker** or **⛔ budget paused** when work is not flowing.
- `docker compose logs -f worker` shows the worker's console output.

## Backups

```bash
npm run backup                               # → data/backups/agentopia-<timestamp>.sqlite
docker compose exec api node_modules/.bin/tsx scripts/backup.ts /data/backup.sqlite
```

`VACUUM INTO` produces a consistent copy while everything is running, and the script runs an integrity
check on it. Back up the `/data` volume (or the file) on a schedule, and keep copies off the machine.

## Upgrades

Schema migrations run automatically at startup and are tracked with `PRAGMA user_version`; an upgrade
test covers Phase 1 → Phase 2. To upgrade: back up, pull, `docker compose up -d --build`.

## Limits of this setup

- SQLite means **one host**. Run several workers on that host if needed (`docker compose up -d --scale worker=2`), but not across machines. A Postgres-backed store is on the roadmap.
- There is one admin token and no per-user accounts yet.
- Alerts (email/push) for budget holds or failures are not built yet; watch the UI or the logs.
