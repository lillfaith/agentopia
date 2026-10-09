# Where research spend goes, and how Agentopia limits it

This page explains the cost of a villager's research task, using real usage records from the Claude API,
and how the research-depth settings bound it. The numbers come from `scripts/cost-probe.ts`. It runs one
fixed research request through the real task engine and records every API response's `usage`, and the
`cost-probe` workflow compares engine versions.

## How a research task is billed

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

## What the baseline did (engine before this change)

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

## What changed

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

## Before and after

See the results table in the pull request that introduced this page, or re-run the `cost-probe`
workflow. It runs each variant several times and has Claude Opus 5.5 grade every answer blind against
the same rubric.
