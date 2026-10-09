# Security model

Agentopia lets AI agents act on your behalf, so its safety rules are enforced **in server code**, not by prompts.

## Secrets
- `ANTHROPIC_API_KEY` (or `ANTHROPIC_API_KEY_FILE`) is read from the server environment only. In Docker,
  use the `*_FILE` variables with Compose secrets so keys never enter the image or `docker inspect` output. It is never stored in the
  database, logged, returned by any endpoint, or sent to the browser. The UI shows only "configured: yes/no".
- `.env`, `data/` and database files are git-ignored.

## Network exposure
- The server binds to `127.0.0.1` by default.
- Binding to any other address **refuses to start** unless `AGENTOPIA_ADMIN_TOKEN` is set. All `/api/*`
  routes except `/api/health` then require `Authorization: Bearer <token>`, compared in constant time.
- Without a token (local mode), requests must carry a loopback `Host` header (DNS-rebinding protection).
- Mutating requests must be `application/json`, and any `Origin` must match the host. Browsers can't send
  that cross-site without a CORS preflight, which the server never approves (CSRF protection).
- For a cloud deployment, put the server behind TLS (a reverse proxy) and use a long random token.

## Agent skills and tools (least privilege)
- There is **no** shell, local file-system or arbitrary-HTTP tool. The **Coding** skill runs code only in
  Anthropic's hosted sandbox, which has no internet and no access to the machine running Agentopia.
- Capabilities are grouped into skill modules (`server/skills/`). "Planned" skills (image, 3D) contribute
  no tools at all until a real integration replaces them.
- Each agent has an explicit skill allowlist (`agents.skills`), enforced when the model's tool list is built
  **and again** when a tool call is executed. Calls to unlisted tools are rejected and reported to the model.
- Tool inputs are validated with zod schemas before execution.
- `delegate_task` is limited by `AGENTOPIA_MAX_DELEGATION_DEPTH`, and agents cannot delegate to themselves.

## Human approval
Tools are tagged with a sensitivity. Anything other than `none` (`external_communication`, `publish`,
`spend`, `deploy`, `destructive`) **always** pauses the task and creates an approval request. This can't
be disabled per agent. Rejections are fed back to the model as errors with your note. In Phase 1 the two
sensitive tools (`publish_content`, `send_email`) are placeholders that record intent and contact no
external system.

## Prompt injection
- Colleague outputs are wrapped in `<colleague_output>` and the system prompt tells agents that such
  content (and web results) is information, not instructions.
- Even a fully hijacked agent can't publish, email, spend, deploy or delete anything without your approval,
  and can only use the tools you've enabled for it.
- Model output is rendered with `react-markdown`, which doesn't render raw HTML. Links open with
  `rel="noopener noreferrer nofollow"`.

## Spending
- Operator **ceilings** (`AGENTOPIA_DAILY_BUDGET_USD`, `AGENTOPIA_MONTHLY_BUDGET_USD`, `AGENTOPIA_MAX_TASK_COST_USD`)
  can't be raised from the UI. The owner can only set lower limits, plus per-villager daily caps.
- Before every model call the worst-case cost of that call is reserved; if it could cross any limit the
  call doesn't start. See [COSTS.md](COSTS.md).
- Schedules have a minimum interval (`AGENTOPIA_MIN_SCHEDULE_INTERVAL_MINUTES`, default 15) and skip runs
  while a budget limit is reached or the previous run is still going.
- `AGENTOPIA_MAX_TURNS_PER_TASK` and `AGENTOPIA_MAX_OUTPUT_TOKENS` bound each task.
- Costs are estimates from list prices; reconcile against your Anthropic invoice.
- The Weekly Town Tax is a calculator only and never moves money.

## Known limitations
- Single admin token; no per-user accounts or roles yet.
- Local tool results are recorded when they run, so a crash-recovered task never repeats them. Hosted
  tools (web search, code execution) interrupted mid-call may be repeated, and billed again, on retry.
- SSE/HTTP traffic is plain HTTP; terminate TLS at a reverse proxy for any non-local deployment.
