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
| Per research task | The task's research depth (Quick / Standard / Deep) | Standard: ~$0.35 on Sonnet | The villager writes up what it found instead of researching further |

**Before every model call** the worst case of that one call is reserved. That is the full input priced
at the cache-write premium, the whole `max_tokens` of output, and the depth's web-search allowance if
research is enabled. If spend + reservation would cross any limit, the call never starts. The budget can therefore
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

## Research tasks: measured costs and research depth

This section explains the cost of a villager's research task, using real usage records from the Claude API,
and how the research-depth settings bound it. The numbers come from `scripts/cost-probe.ts`. It runs one
fixed research request through the real task engine and records every API response's `usage`, and the
`cost-probe` workflow compares engine versions.

### How a research task is billed

A research task is usually **one API call**. Inside that call, Claude runs a server-side loop: it searches,
reads the results, maybe reads a page, and searches again. Each pass of the loop re-reads the conversation
so far, so the input tokens add up across passes. The API reports the passes in `usage.iterations`.

| Charge | Price (Sonnet 5.5 / Haiku 5.5) | Notes |
|---|---|---|
| Fresh input | $2.00 / $0.10 per M tokens | `usage.input_tokens`: the part of the prompt not served from the cache |
| Cache writes | $2.50 / $0.125 per M | 1.25× input; the first time a prompt prefix is stored |
| Cache reads | $0.20 / $0.01 per M | about a tenth of input; every later pass re-reads the stored prefix |
| Output | $10 / $0.50 per M | includes reasoning ("thinking") tokens |
| Web search | $0.01 per search | $10 per 1,000 |
| Web fetch (page read) | no fee | only the tokens the page adds |
| Code execution | free with web tools | Sonnet and Opus filter search results with code |

The four token categories are disjoint. `input_tokens` excludes cached tokens, and the top-level usage
equals the sum of the iterations. The treasury estimate (`estimateCostUsd` in `server/llm/models.ts`)
charges each category once, plus web searches. Tests check this against recorded calls
(`tests/cost.test.ts`).

**Why the token counter looks large.** The town's token counter adds all four categories together. On a
research task most of those tokens are cache reads, which cost a tenth of input. For example, a Sonnet
task can show 117,000 tokens while costing $0.14, of which 103,000 are cache reads ($0.02).

### What the old engine did

Each task was the same request: a market scan for plant-based protein bars.

- **Sonnet 5.5:** one API call with 6 to 10 internal passes, costing $0.11 to $0.16.
  - Web searches were about a third of the cost, output (mostly code written to filter search results)
    about another third, and cache writes and reads the rest.
  - The code-filtering search tools let the model repeat the same search while it fixed its own code.
  - One run used up its 5-search allowance mid-script and answered without any sources.
- **Haiku 5.5:** two API calls, costing $0.056 to $0.069.
  - After researching, the villager saved a memory note. That tool call needs a second API call, and the
    second call **re-sent the whole 42,000 to 50,000-token conversation uncached**, because only the system
    prompt was cached.
  - On Haiku that is a few tenths of a cent. On Sonnet it would be about $0.10 per extra call.
- **Effort:** Pip's effort was `high`. On Haiku that meant about 8,600 reasoning tokens per task.

### What changed

- **History caching.** Every request now uses automatic prompt caching, so the next call in a task
  (after a memory note, a delegated result or an approval) re-reads the conversation at the cache price.
- **Research depth** (`server/engine/depth.ts`). Each task runs at Quick, Standard or Deep (the town
  default is Standard). The depth sets:
  - the number of web searches and page reads for the whole task;
  - the largest page a read can bring in;
  - the number of model turns;
  - a context-size limit;
  - a spend ceiling (scaled up for pricier models, and never above the plan or owner limits);
  - an effort cap.
- **The brief states the research budget**, so the villager plans its queries instead of discovering
  the limit mid-search.
- **A write-up instead of a failure.** When a depth limit is reached, the next call cannot use tools and is
  asked to write up what was found. The same happens when the remaining budget covers a write-up but not
  more research.
- **Model choice.** Quick research uses the lowest-cost model the plan allows unless the task picks a
  model. Any task can pick a model, including a more capable one for hard work.
- **Usage detail.** Each usage row also stores reasoning tokens, internal passes and the largest prompt
  of the call. Every finished task has a **Usage & cost breakdown** (`GET /api/tasks/:id/usage`).

Customer prices, plan limits and the billing ledger did not change. The depth spend ceilings can only
lower a task's limit.

### Before and after (measured, October 2026)

The same request was run through each engine version on the live API.

- Quality is Claude Opus 5.5's blind grade (0–10) against a fixed rubric covering coverage, evidence,
  reliability and usefulness.
- "Next call" is what one more call in the same task costs, for example after the villager saves a
  memory note or an approval comes back.

| Variant | Runs | Avg cost (range) | API calls | Avg quality | Next call |
|---|---|---|---|---|---|
| Sonnet 5.5, old engine | 3 | $0.195 ($0.156–$0.248) | 1 | 5.7 | $0.041 |
| Sonnet 5.5, Standard | 3 | **$0.132** ($0.117–$0.146) | 1 | **6.7** | $0.020 |
| Haiku 5.5, old engine | 3 | $0.068 ($0.068–$0.068) | 2 | 6.3 | $0.0055 |
| Haiku 5.5, Standard | 5 | **$0.051** ($0.048–$0.060) | 1–2 | **6.8** | $0.0009–$0.0059 |
| Quick (Haiku chosen automatically) | 3 | **$0.037** ($0.036–$0.040) | 1–2 | **7.0** | $0.0008–$0.0040 |
| Sonnet 5.5, Deep | 1 | $0.353 | 1 | 8 | — |

- **Cost per task:** about **−32% on Sonnet** and **−25% on Haiku**, with quality the same or slightly
  better. Quick costs **81% less** than the old Sonnet default.
- **History caching:** a follow-up call that used to resend the conversation now re-reads it from the
  cache. In one Quick run the second call read 27,846 tokens from the cache and sent 4 fresh tokens.
  The old engine sent about 50,000 fresh tokens for that call.
- **When the cache doesn't help yet:** if a task finished in one call, the search results the server
  fetched are not always in the cache yet. The next call then writes them once, at the cache-write
  price, and only later calls read them cheaply.
- **Caveats:**
  - Samples are small, and quality differences of about one point are within run-to-run noise.
  - The grader is a Claude model.
  - Web results change from day to day.

Re-run the comparison with the `cost-probe` workflow; the variants are in `scripts/cost-probe-matrix.json`.

## Verifying costs yourself

1. Open a finished task's **Usage & cost breakdown** to see every API call with its tokens by category,
   searches, page reads and estimated cost.
2. Run `npm run verify:live`. Each check prints its request id and estimated cost, and the full run is capped at $0.50 by default.
3. Look up those request ids in the Anthropic Console to compare billed usage.
4. If Agentopia's estimate drifts from your invoice (prices change), update `server/llm/models.ts`. It is the only place prices live.
