# Operating costs

Agentopia is bring-your-own-key: **you pay Anthropic directly** for what your villagers use. Agentopia
itself never charges, and the optional Weekly Town Tax only *suggests* a voluntary pledge.

Every number Agentopia shows is an **estimate** based on list prices in `server/llm/models.ts`.
Always reconcile against the usage and cost pages of your Anthropic Console.

## What you pay for

| Item | Price (USD, Anthropic first-party API) | Tracked by Agentopia? |
|---|---|---|
| Claude Opus 5.5 (default model) | $4 / MTok input, $20 / MTok output, cache reads $0.20 / MTok | ✅ per call |
| Claude Sonnet 5.5 | $2 / MTok input, $10 / MTok output | ✅ |
| Claude Haiku 5.5 | $0.10 / MTok input, $0.50 / MTok output (prompts ≤ 100K tokens) | ✅ |
| Claude Fable 5.1 | $10 / MTok input, $50 / MTok output | ✅ |
| Prompt-cache writes | 1.25× the input price (5-minute cache) | ✅ |
| **Web search** (Research skill) | **$10 per 1,000 searches**, plus the tokens of the results | ✅ search count + cost |
| Web fetch (Research skill) | No extra fee; you pay for the tokens the page adds | ✅ count; tokens included |
| **Code execution sandbox** (Coding skill) | Free when used alongside web search/fetch; otherwise **$0.05 per container-hour after 1,550 free hours/month** per organization | ⚠️ uses counted; **container time is not estimated** |
| Server-side refusal fallback | If a request is declined and re-run on a fallback model, the rescue is billed at that model's rates | ⚠️ priced at the model that served it |
| Your server (if self-hosted in the cloud) | Whatever your VM or container host costs | ❌ |

Thinking tokens count as **output** tokens. Opus 5.5 always thinks adaptively, and the agent's
**Effort** setting (low → max) is the main dial for depth versus cost.

Haiku cache prices and some fallback behaviour are approximations. Batch discounts, regional pricing
and fallback-credit repricing are not modelled.

## How the estimate is made

After every real call, Agentopia records the token usage the API reports (input, output, cache read,
cache write, searches), the model that actually served it, and the API **request id**. It then multiplies
the counts by the list prices. Each villager, task, model, day and schedule shows its own total in the
**💰 Treasury**, and each task shows its own cost in its LIVE proof.

## Budget protection

| Limit | Set by | Default | What happens |
|---|---|---|---|
| Daily | `AGENTOPIA_DAILY_BUDGET_USD` (ceiling) + Settings (lower) | $5 | New calls pause until the next UTC day |
| Monthly | `AGENTOPIA_MONTHLY_BUDGET_USD` + Settings | $50 | New calls pause until the 1st |
| Per task | `AGENTOPIA_MAX_TASK_COST_USD` + Settings | $1 | That task fails with an explanation |
| Per villager (daily) | Villager → Configure | none | Only that villager pauses |

**Before every model call** the worst case of that one call is reserved. That is the full input priced
at the cache-write premium, the whole `max_tokens` of output, and 5 web searches if research is
enabled. If spend + reservation would cross any limit, the call never starts. The budget can therefore
only be overshot by the error in estimating one call's input size.

Paused work keeps its place in the queue. It does **not** burn a retry attempt, and it resumes by itself
when the window resets or you raise the limit. Schedules skip their run while a global limit is reached.

With the default 16,000 `max_tokens`, one Opus 5.5 call reserves about $0.32 of output headroom. A $1
per-task limit therefore allows roughly 2–3 heavy calls before the reservation blocks further turns.
Lower `AGENTOPIA_MAX_OUTPUT_TOKENS` or pick a cheaper model if you want more, smaller calls per task.

## Illustrative costs (assumptions, not measurements)

These examples show the arithmetic. They use **assumed** token counts, not data from a real run. Your
Treasury shows the real numbers after the first runs.

| Work (Opus 5.5) | Assumed usage | ≈ cost |
|---|---|---|
| Manager writes a brief | 1.5K in / 0.8K out | $0.02 |
| Researcher with 4 web searches | 25K in / 2.5K out + 4 searches | $0.19 |
| Copywriter drafts copy | 4K in / 1.5K out | $0.05 |
| Manager reviews & delivers | 6K in / 1.5K out | $0.05 |
| **Whole marketing project** | | **≈ $0.30** |
| Same project on Sonnet 5.5 | same tokens, half the price (searches unchanged) | ≈ $0.17 |
| Same project on Haiku 5.5 (no dynamic-filtering web tools) | same tokens | ≈ $0.05 |

A daily schedule that runs the whole project would cost about 30 × $0.30 ≈ **$9 a month** under these
assumptions. The Schedules panel replaces assumptions with the average of the schedule's last real runs.

## Verifying costs yourself

1. Run `npm run verify:live`. Each check prints its request id and estimated cost, and the full run is capped at $0.50 by default.
2. Look up those request ids in the Anthropic Console to compare billed usage.
3. If Agentopia's estimate drifts from your invoice (prices change), update `server/llm/models.ts`. It is the only place prices live.
