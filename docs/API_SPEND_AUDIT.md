# API spend audit (October 2026)

This is an audit of Agentopia's Anthropic API usage: where tokens and dollars go, what can spend money on its own, and what changed. Cost formulas and measured research costs are in [COSTS.md](COSTS.md).

## Findings

**A research task's "tokens" are mostly cheap re-reads.** A research task is usually one API call in which Claude searches, reads and searches again (a server-side loop). Each pass re-reads the conversation so far. The token counter adds every category together: fresh input, cache writes, cache reads and output. On research tasks, cache reads, which cost a tenth of the input price, are most of that number. For example, a Sonnet task showing 117,000 tokens cost $0.14, and 103,000 of those tokens were cache reads. Cost is the measure to watch, and the task's **Usage & cost breakdown** shows every call.

**Why one research task showed about 40,000 tokens / $0.11.**
- The task record lives in the production database, which wasn't available to this audit. This explanation is inferred from the engine and October's measurements.
- The employee was on **Sonnet 5.5**, the default on every plan, at **Standard** depth.
- The research skill told employees to search for "anything time-sensitive or factual", which is almost everything.
- Standard allowed **6 searches**, and each search costs $0.01 plus the tokens its results add. Searches are typically 35–50% of a Sonnet research task's cost.
- For a general-knowledge question such as "the most misunderstood historical events", most of that searching wasn't needed.

**The same kind of task can show very different token counts.**
- About **3,000 tokens** is what a task looks like when it answers without searching: one call with roughly 2K of instructions and brief plus the answer.
- About **78,700 tokens** was a research task with many searches whose results were re-read on every pass. It cost only about $0.05 because most of those tokens were cache reads.
- Token counts mainly reflect whether and how much the employee searched, and which model it used. They don't measure how efficient the engine is.

**Why an allowance can run out fast.** There are two different allowances. Neither has anything to do with a Claude Code subscription.
1. **Agentopia plan limits.** The Free trial allows $0.75/day and $2/month. At about $0.11 per Sonnet research task, that's about 7 tasks a day and 18 a month. After that, queued work pauses with "Budget limit reached".
2. **Anthropic credits on the operator's API key.** Production and the live GitHub Actions tests share that key unless `ANTHROPIC_API_KEY_CI` is set.
   - `cost-probe`: 5 runs at up to about $2 each, while it still ran on pushes.
   - `verify-live`: 1 run, at most $0.50.
   - `e2e-live`: 16 runs at about $0.001–0.01 each.
   - All three are now manual-only, and a regression test enforces it.

**Nothing in the app spends on its own.** Paid calls come only from:
- tasks someone or a schedule creates;
- instruction drafts the owner asks for;
- retries of a failed task: at most 3 attempts, resumed from the saved conversation, and an errored request isn't billed;
- the self-hosted "Test connection" button, which is disabled in SaaS mode.

Villagers wandering or sleeping, speech bubbles, opening or refreshing the site, the wardrobe, appearance changes, navigating the town and viewing the Treasury make no API calls. A regression test checks this.

## What changed

| Change | Why (evidence) |
|---|---|
| Research skill is **knowledge-first**: answer well-established knowledge directly, and search for what's recent, niche, disputed, numeric or needs a citation. Plan searches, don't repeat them, and fetch a page only when a snippet isn't enough. When the request asks for sources, each key claim is verified with a search and linked (never a link from memory). | The old wording ("search anything factual") made searching the default, and searches are the largest single research cost. |
| **Standard depth: 4 searches, 3 page reads** (was 6 and 4). Quick (3/2) and Deep (12/10) are unchanged. | Fewer searches also means fewer results re-read on every later pass. |
| Town **Model choice** setting (Settings → Research depth & model): **Economy** / **Balanced** (default, same behaviour as before) / **Quality**. | Haiku costs about 1/20 of Sonnet per token, with similar measured quality on research briefs. Opt-in, and an employee's own model setting is never changed. |
| Briefs include at most **10** of an employee's notes: the latest three plus the most relevant to the task (was the latest 20). | Notes are re-read on every pass of a research call. |
| The same job isn't queued twice while it's still waiting or running. | Double clicks or re-submitted forms would pay twice. |
| **Treasury:** who paid (Agentopia vs own keys), what for (assigned / delegated / scheduled / hiring desk / connection tests), cost by billing category, the most expensive tasks, retries, and Anthropic rate limits. | Makes the biggest consumers obvious and separates cheap tokens from expensive ones. |
| Anthropic **rate-limit headers** are captured and a warning is logged under 10%. A 429 names the limit that ran out. "Credit balance too low" says to top up and isn't retried. | Tells "out of credits" apart from "rate limited" apart from "plan limit reached". |
| Live API workflows are **manual-only**, guarded by a regression test. | Paid test runs need the owner's go-ahead. |

## Limits every task already has

| Limit | Where it's set | How it's enforced |
|---|---|---|
| Maximum cost | Per task: min(plan, owner setting, depth ceiling). Plus daily and monthly town limits and each employee's daily cap. | Before every call, the call's worst case (full input at the cache-write price plus all `max_tokens` plus the search allowance) is reserved. If it doesn't fit, the call never starts. If only a write-up fits, the employee writes up what it found instead of failing. |
| Model requests and tool iterations | Depth `maxTurns`: Quick 3, Standard 5, Deep 8 | After the last turn, a tool-free write-up call |
| Web searches / page reads | Depth: Quick 3/2, Standard 4/3, Deep 12/10 | Sent as `max_uses` on the hosted tools, minus what the task already used |
| Page size | Depth: 4K / 8K / 16K tokens per page | `max_content_tokens` on web fetch |
| Context size | Depth: 40K / 90K / 180K tokens | Past it, the next call is the write-up |
| Delegation | `AGENTOPIA_MAX_DELEGATION_DEPTH`, plus 5 delegations per task | The tool refuses past either limit |
| Output length | `AGENTOPIA_MAX_OUTPUT_TOKENS` (default 16,000) and the depth's write-up cap | `max_tokens` on every call |

A task that hits a limit keeps its partial work, because the write-up includes what was found. Limits are never exceeded silently: each one is logged in the task's activity.

## Recommended settings for a personal testing account

Target $0.25–0.50 a day, never more than $1.

| Setting | Value | Where |
|---|---|---|
| Daily limit | **$1.00** | Settings → Budget (server-enforced) |
| Monthly limit | **$15** | Settings → Budget |
| Per-task limit | **$0.25** | Settings → Budget. Standard research on Sonnet fits; Deep needs a higher limit on purpose. |
| Model choice | **Economy** | Settings → Research depth & model |
| Default research depth | **Quick** (pick Standard per task when needed) | Settings → Research depth & model |

With these settings, typical work costs:

| Work | Cost per task |
|---|---|
| Plain writing | under $0.005 |
| Quick research | $0.01–0.04 |
| Standard research on Haiku | $0.03–0.06 |

That's roughly 10–25 tasks a day inside the target, and the $1 cap stops anything beyond it.

**Remaining limitations**
- **Concurrency.** The reservation is per call. Two calls that start at the same moment can both fit and then both spend, so the overshoot is at most one call per concurrently running task. Plans run 1–3 tasks at once.
- **Own keys.** Work on an owner's own key doesn't count toward the plan or town limits. It's still bounded by the employee's daily cap, the per-task and depth limits, approvals and Stop. Provider-side limits and billing apply on that account.
- **Provider-side charges.** Searches inside one call are bounded by `max_uses`, but one call can't be paused mid-way. Costs are estimates from list prices: compare request ids against the Anthropic Console, and update `server/llm/models.ts` if prices change.

## What to check in the Anthropic Console

- **Billing:** credit balance, whether auto-reload is on, and invoices.
- **Limits:** usage tier, monthly spend limit, and per-model rate limits (requests, input and output tokens per minute).
- **Usage:** group by **API key** and **day**. Spikes on 8–10 October 2026 match the CI runs above.
- **API keys:** whether Railway (production) and the GitHub secret use the same key. Create a separate key, ideally in its own workspace, and store it as the repository secret `ANTHROPIC_API_KEY_CI`.
- **Logs:** look up any request id from a task's usage breakdown.

## Benchmark

These are live runs on 10 October 2026: cost-probe workflow, `suite=benchmark`, runs [38088915885](https://github.com/lillfaith/agentopia/actions/runs/38088915885) (a partial first run) and [38089371210](https://github.com/lillfaith/agentopia/actions/runs/38089371210).
- **Variants:**
  - "Before" is the old research prompt with Standard at 6 searches and 4 reads.
  - "After" is this change.
  - Balanced is the default and keeps the employee's model, Sonnet 5.5. Economy uses Haiku 5.5.
- **Setup:** every run used a fresh test town.
- **Spend:** about **$0.97** in total, under the authorised $1.50.
- **Grading:** the blind grading step failed because the shared API key ran out of credits (see the note below), so no scores were produced. I reviewed the 16 outputs by hand instead.

| Task | Before (Sonnet) | After, Balanced (Sonnet) | After, Economy (Haiku) |
|---|---|---|---|
| Plain writing | $0.0061–0.0066 | same as before | **$0.0012–0.0013 (−80%)** |
| General-knowledge research ("three most misunderstood historical events, with a source") | **$0.080–0.099**, 5 searches, 36–45K tokens | **$0.017–0.032 (−73%)**, 0 searches, about 9K tokens | **$0.035 (−61%)**, 3 searches, 36K tokens |
| Multi-source research (Asana / Trello / Notion pricing, linked) | $0.083–0.095, 4–6 searches | $0.085 (run 1, no change); $0.036 (run 2, failed to search) | **$0.068 (−24%)** |
| Coding (parser plus tests in the sandbox) | $0.036 | same as before | **$0.0027 (−93%)** |
| Delegation (brief to the copywriter, plus the copywriter's work) | $0.022 | same as before | **$0.0011 (−95%)** |

**Quality review**
- **Writing, coding and delegation on Haiku:** comparable to Sonnet. Haiku's parser was correct, with more test cases, and rejected years and months instead of approximating them. Its taglines were slightly weaker, with one cliché.
- **General-knowledge research on Balanced:** this was a regression, now fixed.
  - The content was accurate and well organised.
  - The request asked for "a source", and the employee gave book titles and links from memory that it hadn't checked. One of its two answers also had a muddled summary paragraph.
  - The research prompt now says that when a request asks for sources, each key claim is verified with a search and linked, never a link from memory. Questions that don't ask for sources still skip the searches.
  - This fix is covered by a unit test but hasn't been measured live, because the account is out of credits. Expect requests like this to cost between the old $0.09 and the new $0.02, since Standard now caps them at 4 searches.
- **Haiku research:** both Economy research runs cited real, linked pages and flagged where sources conflicted. The multi-source answer was the most thorough of all runs.
- **Pre-existing search flake, not caused by this change:**
  - One "before" and one "after" multi-source run each failed to finish their searches. The model tried to run searches from inside the code sandbox and hit the search limit.
  - Both employees said so honestly and marked the prices unverified.
  - This is a follow-up item. The engine doesn't yet treat "search limit reached with nothing verified" as a reason to retry.

**Takeaways**
- Default (Balanced) customers save most on research questions that well-established knowledge answers, about −70%.
- Source-heavy research costs about the same per search, but it's capped at 4 searches instead of 6.
- The largest saving is the opt-in **Economy** setting: 60–95% cheaper across every task type, with comparable quality in this sample.
- Samples are small (1–2 runs per variant), so treat the percentages as indicative.

**Note: credits ran out during the benchmark.**
- The grading calls were refused with "Your credit balance is too low". The benchmark used the same key as production because `ANTHROPIC_API_KEY_CI` isn't set.
- Until the balance is topped up in the Anthropic Console (Billing), live tasks on Agentopia's key will fail with that message. Tasks on customers' own keys are unaffected.
