# Cost per user and recommended pricing

All model prices come from `server/llm/models.ts` (USD per million tokens). These are **estimates**.
Reconcile them against your Anthropic invoice and the per-user ledger (`usage_daily` in `accounts.sqlite`).

## What one task costs

| Task | Model | Input tokens | Output tokens | Extras | ≈ Cost |
|---|---|---|---|---|---|
| Short writing task (1 turn) | Haiku 5.5 | 2k | 0.5k | — | **$0.0005** (measured in CI: $0.0002) |
| Short writing task (1 turn) | Sonnet 5.5 | 2k | 1.5k | — | **$0.02** |
| Research task (3 turns, 2 searches) | Sonnet 5.5 | 18k | 3k | $0.02 search | **$0.09** |
| Research task | Opus 5.5 | 18k | 3k | $0.02 search | **$0.15** |
| Campaign workflow (brief → research → copy → review) | Sonnet 5.5 | ~35k | ~7k | $0.02 | **$0.16–0.25** |

Prompt caching lowers repeat input costs. Every call is still capped by the per-task limit through the
worst-case reservation, so a single task can never cost more than its plan's per-task limit.

## Cost per user per month (model spend)

| Usage profile | Monthly model spend |
|---|---|
| Light: about 40 writing tasks | ~$1 |
| Typical: about 120 tasks plus 8 campaigns | ~$5–7 |
| Heavy | Capped by the plan's monthly limit (Starter $8, Pro $25) |

## Fixed and per-user costs

- **Hosting:** one Railway service plus a volume, about $20–40 a month in total. That is under $0.10 per user at
  a few hundred users. A town file is 0.5–5 MB.
- **Stripe:** 2.9% + $0.30 per charge. That is $0.85 on $19 and $1.72 on $49.
- **Trial abuse ceiling:**
  - At most $2 per trial account (monthly limit).
  - New sign-ups are rate-limited (5 per hour per IP).
  - `AGENTOPIA_GLOBAL_DAILY_BUDGET_USD` caps total spend across all users.

## Recommended plans

| Plan | Price | Included AI spend | Worst-case margin* | Typical margin |
|---|---|---|---|---|
| Free trial (14 days) | $0 | $0.75/day, $2 total/month | −$2 | — |
| **Starter** | **$19/mo** | $2/day, $8/month, Haiku + Sonnet, 2 villagers at once | $10.15 (53%) | ~$12–14 (65–75%) |
| **Pro** | **$49/mo** | $6/day, $25/month, + Opus, 3 at once | $22.28 (45%) | ~$35 (70%) |

\*Worst case means the user spends the whole monthly allowance.

Recommendations:
- Offer annual billing at about 20% off, using the same price ids pattern in Stripe.
- Keep usage caps in dollars of model spend. Plan limits and the budget engine already work this way, and it
  keeps margins positive however a user's tasks are mixed.
- Before scaling paid acquisition, add email verification for trials. That needs an email provider, which is
  not implemented yet. It is the main remaining guard against trial farming.
- Review limits monthly against `usage_daily`. If typical spend sits well below the caps, the caps can rise as
  a selling point without hurting margins.
