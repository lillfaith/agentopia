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
| `AGENTOPIA_DAILY_BUDGET_USD` | `5` | Stop new model calls when today's estimated spend reaches this (0 = no cap) |
| `AGENTOPIA_MAX_TURNS_PER_TASK` | `8` | Model turns per task |
| `AGENTOPIA_WORKER_CONCURRENCY` | `2` | Tasks running at once (still one per agent) |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | Binding |
| `AGENTOPIA_ADMIN_TOKEN` | – | Required for non-loopback binding; enter it in the web UI when prompted |

## Running on a server (preview)
Phase 1 runs as one Node process. On a VM:
1. Install Node 22.13+, clone, `npm ci`, `npm run build`.
2. Set `HOST=0.0.0.0`, a long random `AGENTOPIA_ADMIN_TOKEN`, and your API key in `.env`.
3. Run `npm start` under a process manager (systemd, pm2) and put a TLS reverse proxy (Caddy, nginx) in front.
4. Back up `data/agentopia.sqlite`.

Tasks keep running with no browser open. On restart, interrupted tasks are re-queued and resume from
their saved transcripts. Docker images and Postgres support are planned for Phase 2.

## Troubleshooting
- **"No API key configured" banner**: add `ANTHROPIC_API_KEY` to `.env` and restart the server.
- **Tasks fail with 401**: the key is invalid or revoked.
- **"Daily budget reached"**: raise `AGENTOPIA_DAILY_BUDGET_USD` or wait for the next UTC day, then use ↻ Retry on the task.
- **Blank or black world**: your browser or GPU lacks WebGL2; try another browser or enable hardware acceleration.
- **"Refusing to bind"**: you set a non-loopback `HOST` without `AGENTOPIA_ADMIN_TOKEN`.
