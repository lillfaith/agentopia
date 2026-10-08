# Installation

## Requirements
- **Node.js 22.13 or newer** (`node -v`). Agentopia uses the built-in `node:sqlite` module; no compiler needed.
  You'll see a harmless "SQLite is an experimental feature" warning.
- An Anthropic API key for real agent work (<https://console.anthropic.com>).
- A WebGL2-capable browser (current Chrome, Edge, Firefox or Safari).

## Local install
```bash
npm install
cp .env.example .env
# edit .env: ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```
- Web client: <http://127.0.0.1:5173> (Vite dev server, proxies `/api` to the backend)
- API: <http://127.0.0.1:8787>
- Database: `./data/agentopia.sqlite` (created automatically; back it up to keep your town)

### Single-process mode
```bash
npm run build
npm start          # serves the client and API on http://127.0.0.1:8787
```

### Offline demo (no key)
Set `AGENTOPIA_SIMULATION=true`. Agents produce clearly labelled placeholder output at $0. Remove the
setting, or add a key (a key always wins), for real work.

## Configuration
All settings are environment variables; see `.env.example` for the full, commented list. Highlights:

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Claude API key (server-side only) |
| `AGENTOPIA_DEFAULT_MODEL` | `claude-opus-5-5` | Model for newly seeded agents (each agent can change it) |
| `AGENTOPIA_REFUSAL_FALLBACK` | `default` | Server-side refusal fallback on supported models (`off` to disable) |
| `AGENTOPIA_DAILY_BUDGET_USD` | `5` | Daily ceiling (UTC). The UI can only set lower limits. 0 = none |
| `AGENTOPIA_MONTHLY_BUDGET_USD` | `50` | Monthly ceiling |
| `AGENTOPIA_MAX_TASK_COST_USD` | `1` | Per-task ceiling |
| `AGENTOPIA_ROLE` | `all` | `all`, `api` or `worker` (see DEPLOYMENT.md) |
| `AGENTOPIA_MIN_SCHEDULE_INTERVAL_MINUTES` | `15` | Shortest "every N minutes" schedule |
| `AGENTOPIA_MAX_TURNS_PER_TASK` | `8` | Model turns per task |
| `AGENTOPIA_WORKER_CONCURRENCY` | `2` | Tasks running at once (still one per agent) |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | Binding |
| `AGENTOPIA_ADMIN_TOKEN` | – | Required for non-loopback binding; enter it in the web UI when prompted |

## Verify the Claude integration
```bash
npm run verify:live            # all checks + an end-to-end agent task, capped at $0.50
npm run verify:live -- --checks messages --skip-agent-task   # cheapest possible check
```
Results (with request ids and estimated cost) are printed and saved; see **Settings → Live verification**.

## Running on a server
The recommended path is Docker Compose: see [DEPLOYMENT.md](DEPLOYMENT.md). Without Docker, on a VM:
1. Install Node 22.13+, clone, `npm ci`, `npm run build`.
2. Set `HOST=0.0.0.0`, a long random `AGENTOPIA_ADMIN_TOKEN`, and your API key in `.env`.
3. Run `npm start` under a process manager (systemd, pm2) and put a TLS reverse proxy (Caddy, nginx) in front.
4. Back up `data/agentopia.sqlite`.

Tasks and schedules keep running with no browser open. On restart, interrupted tasks are re-queued and
resume from their saved transcripts. Back up with `npm run backup`.

## Troubleshooting
- **"No API key configured" banner**: add `ANTHROPIC_API_KEY` to `.env` and restart the server.
- **Tasks fail with 401**: the key is invalid or revoked.
- **"⛔ budget paused"**: a limit was reached. Work resumes by itself when it resets, or raise the limit (Settings, or the ceiling in the environment).
- **"⚙️ no worker"**: nothing is executing tasks. Start the server, or `npm run worker` if you run the API separately.
- **Blank or black world**: your browser or GPU lacks WebGL2; try another browser or enable hardware acceleration.
- **"Refusing to bind"**: you set a non-loopback `HOST` without `AGENTOPIA_ADMIN_TOKEN`.
