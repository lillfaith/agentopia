import { useEffect, useState } from "react";
import type { TownTaxSettings, TreasurySummary } from "../../../shared/types";
import { api, getToken, setToken } from "../api/client";
import { useTown } from "../state/store";
import { listThemes } from "../theme-engine/registry";
import { useTheme } from "../theme-engine/ThemeContext";
import { AgentName, Badge, Drawer, Empty, fmtTokens, fmtUsd } from "./common";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ───────────────────────── treasury ─────────────────────────

export function TreasuryPanel() {
  const theme = useTheme();
  const close = useTown((s) => s.openPanel);
  const lastEvent = useTown((s) => s.snapshot?.events.at(-1)?.id ?? 0);
  const [t, setT] = useState<TreasurySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const h = setTimeout(() => {
      api.treasury().then(setT, (e) => setError(errText(e)));
    }, 200);
    return () => clearTimeout(h);
  }, [lastEvent]);

  return (
    <Drawer side="left" title="Treasury" icon={theme.ui.icons.treasury} onClose={() => close(null)} wide>
      {error && <div className="error-box">{error}</div>}
      {!t ? (
        <Empty>Counting coins…</Empty>
      ) : (
        <>
          <div className="stat-grid four">
            <div>
              <b>{fmtUsd(t.totals.costUsd)}</b>
              <small>Est. total spend</small>
            </div>
            <div>
              <b>{fmtTokens(t.totals.inputTokens)}</b>
              <small>Input tokens</small>
            </div>
            <div>
              <b>{fmtTokens(t.totals.outputTokens)}</b>
              <small>Output tokens</small>
            </div>
            <div>
              <b>{t.totals.requests}</b>
              <small>API calls · {t.totals.webSearches} searches</small>
            </div>
          </div>

          <section className="card">
            <h3>Today's budget</h3>
            {t.today.budgetUsd > 0 ? (
              <>
                <div className="meter" title={`${fmtUsd(t.today.costUsd)} of ${fmtUsd(t.today.budgetUsd)}`}>
                  <div className={t.today.costUsd >= t.today.budgetUsd ? "over" : ""} style={{ width: `${Math.min(100, (t.today.costUsd / t.today.budgetUsd) * 100)}%` }} />
                </div>
                <small className="muted">
                  {fmtUsd(t.today.costUsd)} of {fmtUsd(t.today.budgetUsd)} (UTC day). New model calls stop at the cap — set <code>AGENTOPIA_DAILY_BUDGET_USD</code>.
                </small>
              </>
            ) : (
              <small className="muted">No daily cap configured.</small>
            )}
          </section>

          <section className="card">
            <h3>Spend by villager</h3>
            {!t.byAgent.length && <Empty>No real API usage recorded yet.</Empty>}
            <div className="hbars">
              {t.byAgent.map((a) => {
                const max = t.byAgent[0]?.costUsd || 1;
                return (
                  <div key={a.agentId} className="hbar" title={`${fmtUsd(a.costUsd)} · ${a.requests} calls · ${fmtTokens(a.inputTokens)} in / ${fmtTokens(a.outputTokens)} out`}>
                    <span className="hbar-label">
                      <AgentName id={a.agentId} />
                    </span>
                    <span className="hbar-track">
                      <span className="hbar-fill" style={{ width: `${Math.max(1.5, (a.costUsd / max) * 100)}%` }} />
                    </span>
                    <span className="hbar-value">{fmtUsd(a.costUsd)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card">
            <h3>Daily spend (last 14 days)</h3>
            {t.daily.length ? (
              <div className="columns" role="img" aria-label="Daily estimated spend">
                {t.daily.map((d) => {
                  const max = Math.max(...t.daily.map((x) => x.costUsd), 0.0001);
                  return (
                    <div key={d.day} className="col" title={`${d.day}: ${fmtUsd(d.costUsd)} · ${fmtTokens(d.tokens)} tokens`}>
                      <span className="col-fill" style={{ height: `${Math.max(2, (d.costUsd / max) * 100)}%` }} />
                      <small>{d.day.slice(5)}</small>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty>No data yet.</Empty>
            )}
          </section>

          <section className="card">
            <h3>By model</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Calls</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {t.byModel.map((m) => (
                  <tr key={m.model}>
                    <td className="mono">{m.model}</td>
                    <td>{m.requests}</td>
                    <td>{fmtTokens(m.inputTokens)}</td>
                    <td>{fmtTokens(m.outputTokens)}</td>
                    <td>{fmtUsd(m.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <TownTax t={t} />
          <p className="muted small">{t.pricingNote}</p>
        </>
      )}
    </Drawer>
  );
}

function TownTax({ t }: { t: TreasurySummary }) {
  const push = useTown((s) => s.pushToast);
  const [s, setS] = useState<TownTaxSettings>(t.townTax.settings);
  const save = async (patch: Partial<TownTaxSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    try {
      await api.updateSettings({ townTax: next });
    } catch (e) {
      push({ tone: "bad", text: errText(e) });
    }
  };
  return (
    <section className="card conservation">
      <div className="row between">
        <h3>🌿 Conservation Center — Weekly Town Tax</h3>
        <Badge tone={s.enabled ? "good" : "muted"}>{s.enabled ? "on" : "off"}</Badge>
      </div>
      <p className="muted small">
        An optional, voluntary pledge calculated from your AI operating costs. <b>Agentopia never charges or donates money</b> — it only suggests an amount you can give yourself.
      </p>
      <label className="check">
        <input type="checkbox" checked={s.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
        <span>Calculate a weekly pledge</span>
      </label>
      <div className="grid2">
        <label>
          Based on
          <select value={s.mode} onChange={(e) => save({ mode: e.target.value as TownTaxSettings["mode"] })}>
            <option value="percent_of_cost">% of AI spend</option>
            <option value="per_million_tokens">$ per million tokens</option>
          </select>
        </label>
        <label>
          {s.mode === "percent_of_cost" ? "Rate (%)" : "Rate ($ / 1M tokens)"}
          <input type="number" min={0} max={s.mode === "percent_of_cost" ? 100 : 1000} step={0.5} value={s.rate} onChange={(e) => save({ rate: Number(e.target.value) })} />
        </label>
        <label>
          Weekly cap ($)
          <input type="number" min={0} step={1} value={s.weeklyCapUsd} onChange={(e) => save({ weeklyCapUsd: Number(e.target.value) })} />
        </label>
        <label>
          Cause
          <input value={s.cause} maxLength={200} onChange={(e) => setS({ ...s, cause: e.target.value })} onBlur={() => save({})} />
        </label>
      </div>
      <div className="pledge">
        <div>
          <small className="muted">Week of {t.townTax.weekStart}</small>
          <div>
            {fmtUsd(t.townTax.weekCostUsd)} spend · {fmtTokens(t.townTax.weekTokens)} tokens
          </div>
        </div>
        <div className="pledge-amount">
          <small className="muted">Suggested pledge</small>
          <b>{fmtUsd(t.townTax.suggestedPledgeUsd)}</b>
          {t.townTax.capped && <small className="muted">capped</small>}
        </div>
      </div>
    </section>
  );
}

// ───────────────────────── settings ─────────────────────────

export function SettingsPanel() {
  const theme = useTheme();
  const snap = useTown((s) => s.snapshot)!;
  const close = useTown((s) => s.openPanel);
  const push = useTown((s) => s.pushToast);
  const load = useTown((s) => s.load);
  const [townName, setTownName] = useState(snap.settings.townName);
  const [token, setTok] = useState(getToken());
  const st = snap.status;
  const save = async (patch: Parameters<typeof api.updateSettings>[0]) => {
    try {
      await api.updateSettings(patch);
      await load();
      push({ tone: "good", text: "Saved" });
    } catch (e) {
      push({ tone: "bad", text: errText(e) });
    }
  };
  return (
    <Drawer side="left" title="Settings" icon={theme.ui.icons.settings} onClose={() => close(null)}>
      <section className="card">
        <h3>AI provider</h3>
        <dl className="kv">
          <dt>Mode</dt>
          <dd>
            {st.provider.mode === "live" && <Badge tone="good">Live — Claude API</Badge>}
            {st.provider.mode === "simulation" && <Badge tone="warn">Simulation (no AI calls)</Badge>}
            {st.provider.mode === "unconfigured" && <Badge tone="bad">No API key</Badge>}
          </dd>
          <dt>API key</dt>
          <dd>{st.provider.keyConfigured ? "Configured on the server (never sent to the browser)" : "Not set — add ANTHROPIC_API_KEY to .env and restart"}</dd>
          <dt>Refusal fallback</dt>
          <dd>{st.provider.refusalFallback === "default" ? "Server-side default fallback (supported models)" : "Off"}</dd>
          <dt>Worker</dt>
          <dd>
            {st.worker.running ? "Running" : "Stopped"} · {st.worker.activeTasks}/{st.worker.concurrency} active
          </dd>
          <dt>Limits</dt>
          <dd>
            Daily budget {st.limits.dailyBudgetUsd ? fmtUsd(st.limits.dailyBudgetUsd) : "none"} · {st.limits.maxTurnsPerTask} turns/task · delegation depth {st.limits.maxDelegationDepth}
          </dd>
          <dt>Version</dt>
          <dd>{st.version}</dd>
        </dl>
        <p className="muted small">Keys and limits are server environment variables (see .env.example), so they can't be changed or read from the browser.</p>
      </section>

      <section className="card form">
        <h3>Town</h3>
        <label>
          Town name
          <div className="row gap-s">
            <input value={townName} maxLength={40} onChange={(e) => setTownName(e.target.value)} />
            <button className="btn" onClick={() => save({ townName })}>
              Save
            </button>
          </div>
        </label>
        <label>
          Theme
          <select value={snap.settings.themeId} onChange={(e) => save({ themeId: e.target.value })}>
            {listThemes().map((th) => (
              <option key={th.id} value={th.id}>
                {th.name} v{th.version}
              </option>
            ))}
          </select>
        </label>
        <small className="muted">
          {theme.description} Themes change only visuals and sound — villagers, tasks and data stay the same. More theme packs can be registered via the theme engine.
        </small>
      </section>

      <section className="card">
        <h3>Agent tools</h3>
        <ul className="task-mini">
          {st.tools.map((tool) => (
            <li key={tool.id}>
              <span>
                <b>{tool.label}</b> <small className="muted">{tool.id}</small>
              </span>
              <span className="row gap-s">
                {tool.requiresApproval && <Badge tone="warn">approval</Badge>}
                <Badge tone={tool.implementation === "real" ? "good" : "muted"}>{tool.implementation}</Badge>
              </span>
            </li>
          ))}
        </ul>
        <p className="muted small">No shell, file-system or unrestricted network tools exist. Each villager may only call tools enabled in its Configure tab, enforced on the server.</p>
      </section>

      <section className="card form">
        <h3>Access token</h3>
        <p className="muted small">
          {st.authRequired ? "This server requires its AGENTOPIA_ADMIN_TOKEN." : "Not required (server bound to localhost without a token)."} Stored only in this browser.
        </p>
        <div className="row gap-s">
          <input type="password" value={token} placeholder="Admin token" onChange={(e) => setTok(e.target.value)} />
          <button
            className="btn"
            onClick={() => {
              setToken(token);
              void load();
            }}
          >
            Use
          </button>
        </div>
      </section>
    </Drawer>
  );
}
