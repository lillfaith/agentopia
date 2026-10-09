import { useEffect, useState } from "react";
import type { Agent, ResearchDepth, TaskUsageBreakdown } from "../../../shared/types";
import { DEMO, api } from "../api/client";
import { useTown } from "../state/store";
import { fmtUsd } from "./common";

const n = (v: number) => v.toLocaleString("en-US");
const usd = (v: number) => (v === 0 ? "$0" : v < 1 ? `$${v.toFixed(4)}` : fmtUsd(v));
const modelLabel = (id: string) => useTown.getState().snapshot?.status.models.find((m) => m.id === id)?.label ?? id;
const shortModel = (id: string) => modelLabel(id).replace(/^Claude /, "");
const DEPTH_LABEL: Record<ResearchDepth, string> = { quick: "Quick", standard: "Standard", deep: "Deep" };

/**
 * Where a task's tokens and dollars went: every recorded API call, split into fresh input,
 * cache writes, cache reads, output (incl. reasoning) and web-search fees. Loads on open.
 */
export function TaskUsage({ taskId, calls }: { taskId: string; calls: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TaskUsageBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || DEMO) return;
    api.taskUsage(taskId).then(setData, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, taskId, calls]);
  if (!calls) return null;
  return (
    <details className="usage" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="muted small">Usage &amp; cost breakdown</summary>
      {error && <div className="error-box">{error}</div>}
      {!data && !error && <p className="muted small">Loading…</p>}
      {data && <Breakdown data={data} />}
    </details>
  );
}

function Breakdown({ data }: { data: TaskUsageBreakdown }) {
  const t = data.totals;
  const c = data.cost;
  return (
    <div className="stack">
      <div className="usage-facts">
        <span>
          <b>{data.models.map(modelLabel).join(", ")}</b>
        </span>
        {data.depth && <span>{DEPTH_LABEL[data.depth]} depth</span>}
        <span>
          {t.apiCalls} API call{t.apiCalls === 1 ? "" : "s"}
          {t.serverIterations > t.apiCalls ? ` · ${t.serverIterations} model steps` : ""}
        </span>
        <span>
          <b>~{usd(c.totalUsd)}</b> estimated
        </span>
      </div>
      <div className="md-table">
        <table className="usage-table">
          <thead>
            <tr>
              <th>Charge</th>
              <th>Tokens / uses</th>
              <th>Est. cost</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Fresh input</td>
              <td>{n(t.freshInputTokens)}</td>
              <td>{usd(c.freshInputUsd)}</td>
            </tr>
            <tr>
              <td>Cache writes</td>
              <td>{n(t.cacheWriteTokens)}</td>
              <td>{usd(c.cacheWriteUsd)}</td>
            </tr>
            <tr>
              <td>Cache reads</td>
              <td>{n(t.cacheReadTokens)}</td>
              <td>{usd(c.cacheReadUsd)}</td>
            </tr>
            <tr>
              <td>Output{t.thinkingTokens ? <small className="muted"> (incl. {n(t.thinkingTokens)} reasoning)</small> : null}</td>
              <td>{n(t.outputTokens)}</td>
              <td>{usd(c.outputUsd)}</td>
            </tr>
            <tr>
              <td>Web searches</td>
              <td>{n(t.webSearches)}</td>
              <td>{usd(c.webSearchUsd)}</td>
            </tr>
            <tr>
              <td>Page reads</td>
              <td>{n(t.webFetches)}</td>
              <td className="muted">tokens only</td>
            </tr>
            <tr className="total">
              <td>Total</td>
              <td>{n(t.allTokens)} tokens</td>
              <td>{usd(c.totalUsd)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {data.notes.length > 0 && (
        <ul className="usage-notes small muted">
          {data.notes.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      {data.calls.length > 0 && (
        <details>
          <summary className="muted small">Each API call</summary>
          <div className="md-table">
            <table className="usage-table calls">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Model</th>
                  <th title="Fresh input tokens">Fresh</th>
                  <th title="Cache write tokens">Write</th>
                  <th title="Cache read tokens">Read</th>
                  <th title="Output tokens">Out</th>
                  <th title="Web searches / page reads">Web</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.calls.map((call, i) => (
                  <tr key={call.id} title={call.requestId ? `Request ${call.requestId}` : "Simulated call"}>
                    <td>{i + 1}</td>
                    <td>{shortModel(call.model)}</td>
                    <td>{n(call.freshInputTokens)}</td>
                    <td>{n(call.cacheWriteTokens)}</td>
                    <td>{n(call.cacheReadTokens)}</td>
                    <td>{n(call.outputTokens)}</td>
                    <td>
                      {call.webSearches}/{call.webFetches}
                    </td>
                    <td>{usd(call.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <small className="muted">
        Estimates from list prices. Cache reads cost about a tenth of fresh input, and each category is counted once. Your Anthropic invoice is the final word.
      </small>
    </div>
  );
}

/** Research depth and model choice for a new task. Depth only shows for villagers who research the web. */
export function TaskRunOptions({
  agent,
  depth,
  model,
  onChange,
}: {
  agent: Agent | undefined;
  depth: ResearchDepth | "";
  model: string;
  onChange: (next: { depth: ResearchDepth | ""; model: string }) => void;
}) {
  const status = useTown((s) => s.snapshot!.status);
  const defaultDepth = useTown((s) => s.snapshot!.settings.defaultDepth);
  if (!agent) return null;
  const researches = agent.skills.includes("research");
  const allowed = status.models.filter((m) => !status.allowedModels || status.allowedModels.includes(m.id));
  const chosen = status.depths.find((d) => d.id === (depth || defaultDepth));
  return (
    <div className="run-options">
      {researches && (
        <label>
          Research depth
          <select value={depth} onChange={(e) => onChange({ depth: e.target.value as ResearchDepth | "", model })}>
            <option value="">Town default ({DEPTH_LABEL[defaultDepth]})</option>
            {status.depths.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Model
        <select value={model} onChange={(e) => onChange({ depth, model: e.target.value })}>
          <option value="">{researches && (depth || defaultDepth) === "quick" ? "Automatic (lower-cost for Quick)" : `${agent.name}'s model (${modelLabel(agent.model)})`}</option>
          {allowed.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} · ${m.inputPerMTok}/${m.outputPerMTok} per M tokens
            </option>
          ))}
        </select>
      </label>
      {researches && chosen && (
        <small className="muted run-hint">
          {chosen.description} Up to {chosen.maxSearches} searches and {chosen.maxFetches} page reads, about {fmtUsd(chosen.maxTaskUsd)} at most on Sonnet.
        </small>
      )}
    </div>
  );
}
