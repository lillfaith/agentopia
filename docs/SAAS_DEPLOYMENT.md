# Deploying Agentopia as a SaaS (Railway)

One Railway service runs everything: the web app, the API, and the background worker for every user's
town. It uses the repository's `Dockerfile` and `railway.json`. State lives on one Railway volume
mounted at `/data`:

```
/data/accounts.sqlite        users, sessions, billing state, audit log, per-user spend ledger
/data/towns/<uuid>.sqlite    one private database per user town
/data/backups/<timestamp>/   automatic snapshots of all of the above
```

**Run exactly one replica.** The towns are SQLite files on a single volume. To run more than one
instance you would first need the Postgres path described in `docs/SAAS_PLAN.md`.

## 1. Create the service

1. In Railway, choose **New project → Deploy from GitHub repo** and pick this repository.
   Railway reads `railway.json`, which builds with the `Dockerfile` and health-checks `/api/ready`.
   The image runs `scripts/start.sh`, which applies migrations and then starts the server. The app
   detects Railway from the `RAILWAY_*` variables Railway sets, and then defaults to SaaS mode with
   data in `/data`.
2. **Add a volume** to the service with mount path `/data`. Railway volumes are owned by root. The
   start script makes the volume writable and then runs the app as the unprivileged `node` user, so
   no extra variable is needed.
3. Add a domain under **Settings → Networking**, or attach your own custom domain. Railway
   terminates TLS.

## 2. Environment variables

Required:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your key. Mark it as a secret. It never reaches the browser |

Defaults on Railway (set a variable only to override it):
- `AGENTOPIA_MODE=saas`
- `AGENTOPIA_DATA_DIR=/data`
- `AGENTOPIA_TRUST_PROXY=true`, so client IPs for rate limiting come from Railway's `X-Forwarded-For`
- `AGENTOPIA_PUBLIC_ORIGIN=https://<RAILWAY_PUBLIC_DOMAIN>`. Set it yourself when you use a custom
  domain. It is used for CSRF origin checks, secure cookies and Stripe redirects.

Recommended:

| Variable | Default | Purpose |
|---|---|---|
| `AGENTOPIA_GLOBAL_DAILY_BUDGET_USD` | `0` (off) | Operator ceiling on model spend across all users per UTC day. Set this, for example to `50` |
| `AGENTOPIA_GLOBAL_CONCURRENCY` | `8` | Tasks running at once across all towns |
| `AGENTOPIA_ERROR_WEBHOOK_URL` | none | Slack, Discord or other incoming-webhook URL for error alerts. Alerts are rate-limited |
| `AGENTOPIA_BACKUP_INTERVAL_HOURS` | `24` in production | How often snapshots are taken. `0` turns them off |
| `AGENTOPIA_BACKUP_KEEP` | `7` | Number of snapshots kept on the volume |
| `AGENTOPIA_SESSION_DAYS` | `30` | Sliding session lifetime |

Billing: set all four of these, or none of them.

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` (`sk_test_…` while testing) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from the webhook endpoint below |
| `STRIPE_PRICE_STARTER` | Price id of the $19/month recurring price |
| `STRIPE_PRICE_PRO` | Price id of the $49/month recurring price |

Optional tuning, which applies to every town:
- `AGENTOPIA_MAX_TURNS_PER_TASK` (8)
- `AGENTOPIA_MAX_OUTPUT_TOKENS` (16000)
- `AGENTOPIA_MAX_DELEGATION_DEPTH` (3)
- `AGENTOPIA_MIN_SCHEDULE_INTERVAL_MINUTES` (15)
- `AGENTOPIA_LOG_FORMAT=json` to get JSON logs outside production
- `AGENTOPIA_WEB_TOOLS=basic` to use the plain web search and fetch tools on every model, instead of the
  code-filtering versions on Sonnet and Opus. Measured on Sonnet, the plain tools cost more per research
  task (see `docs/COSTS.md`), so leave this unset unless you have a reason.

In SaaS mode the following are ignored, because each user's plan decides them (see `server/saas/plans.ts`):
- the per-town budget variables (`AGENTOPIA_DAILY_BUDGET_USD`, …)
- `AGENTOPIA_DEFAULT_MODEL`

`AGENTOPIA_SIMULATION` is refused in production.

## 3. Stripe

1. **Products:** create two products, Starter and Pro, each with a monthly recurring price. Put the
   price ids in the variables above.
2. **Webhook:** under **Developers → Webhooks → Add endpoint**, use the URL
   `https://your-domain/api/stripe/webhook`. Subscribe to these events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`

   Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. **Customer portal:** under **Settings → Billing → Customer portal**, allow:
   - updating payment methods;
   - cancelling (at period end);
   - switching between the Starter and Pro prices.
4. **Payment retries:** configure Smart Retries under **Billing → Revenue recovery**.
   - While Stripe retries, the subscription is `past_due`, and the user keeps working with a warning.
   - When Stripe gives up, the subscription becomes `canceled` or `unpaid`, and new work is held.

Entitlements change only through verified webhooks. If a webhook is delayed, the user's plan updates
when it arrives. The browser can never set a plan.

## 4. Verify before going live

Do these in order. Do not announce the service until each one passes.

- [ ] `npm run typecheck && npm test && npm run build` pass. The `ci` workflow runs these on every push.
- [ ] The `e2e-live` workflow is green. It checks that sign up → project → task → background run → real
      Claude output → output persists across a restart all work against the live API.
- [ ] `GET https://your-domain/api/ready` returns `{"ready":true,…}`.
- [ ] Sign up in a browser and assign a task. It finishes with a **live** badge and a request id.
- [ ] Response headers include `content-security-policy` and `strict-transport-security`, and the
      session cookie is `__Host-agentopia_session; Secure; HttpOnly`.
- [ ] Stripe in test mode, using `sk_test_` and test prices:
  - [ ] Check out with card `4242 4242 4242 4242`. The plan shows **Pro (active)** in Settings.
  - [ ] Send a test `invoice.payment_failed`. The plan shows the past-due warning.
  - [ ] Cancel in the portal. At period end new work is held.
- [ ] Then switch to live keys and prices.
- [ ] Press **Stop all**. Running tasks are cancelled, and nothing starts until you press Resume.
- [ ] `AGENTOPIA_GLOBAL_DAILY_BUDGET_USD` is set, and an Anthropic console spend limit is set as a second line of defence.
- [ ] `AGENTOPIA_ERROR_WEBHOOK_URL` delivers a message. To trigger one, stop the volume briefly, or point
      the webhook at a request bin first.
- [ ] A backup snapshot appears in `/data/backups` after the first interval. Restoring is described below.
- [ ] Read `docs/SECURITY.md` and the open items under "Not yet implemented" below.

## 5. Operations

- **Logs:** in production every log line is a JSON object (`level`, `msg`, `scope`, `error`), which
  Railway's log explorer can filter, for example `@level:error`.
- **Health:** `/api/health` checks the process is alive. `/api/ready` checks that the accounts
  database is reachable and the worker is running.
- **Migrations:** these run automatically before every start through `npm run migrate`, which
  migrates the accounts database and every town. If any database fails, the deploy fails and the
  previous version keeps serving. Migrations only ever add; never edit a shipped one.
- **Backups:**
  - Automatic snapshots are written to `/data/backups/<timestamp>/`.
  - To take one on demand, run `railway run npm run backup`.
  - For off-site copies, also enable Railway's volume backups.
  - To restore, stop the service, copy the snapshot's `accounts.sqlite` and `towns/*.sqlite` over
    `/data`, then start the service.
  - To restore a single user, copy only their `towns/<id>.sqlite`. You can find the id in
    `accounts.sqlite`, table `towns`.
- **Deleting a user:** delete their row from `users`, which cascades to their town record and
  sessions. Then delete `towns/<id>.sqlite`.
- **Cost watch:**
  - `accounts.sqlite` → `usage_daily` holds model spend per user per day.
  - Every finished task has a **Usage & cost breakdown** (also `GET /api/tasks/:id/usage`): tokens by
    category, API calls, web searches and page reads, and the estimated cost of each charge.
  - Compare it against `docs/PRICING.md` monthly. `docs/COSTS.md` explains where research spend goes.

## Not yet implemented (labelled in the product)

- **Email:**
  - Email verification and password reset need an email provider. Until then, an operator resets a
    password by deleting the user's sessions and setting a new hash with `hashPassword` from
    `server/saas/passwords.ts`.
  - The `send_email` and `publish_content` agent tools are placeholders. Approval works, but nothing
    is sent or published.
- **Media:** image generation and 3D modelling skills are listed as planned and cannot be enabled.
- **Scaling beyond one instance:** this needs the Postgres migration path in `docs/SAAS_PLAN.md`.
