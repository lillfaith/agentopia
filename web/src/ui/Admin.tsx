import { useEffect, useState } from "react";
import type { TownTaxSettings, TreasurySummary } from "../../../shared/types";
import { api, getToken, setToken } from "../api/client";
import { useTown } from "../state/store";
import { listThemes } from "../theme-engine/registry";
import { browserTimezone } from "../environment/dayCycle";
import { useTheme } from "../theme-engine/ThemeContext";
import { AgentName, Badge, Drawer, Empty, fmtTokens, fmtUsd, timeAgo } from "./common";

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
            <h3>Budget</h3>
            {[
              { label: "Today (UTC)", spent: t.budget.spent.todayUsd, limit: t.budget.effective.dailyUsd },
              { label: "This month", spent: t.budget.spent.monthUsd, limit: t.budget.effective.monthlyUsd },
            ].map((row) => (
              <div key={row.label} className="budget-row">
                <span>{row.label}</span>
                <div className="meter" title={`${fmtUsd(row.spent)} of ${row.limit > 0 ? fmtUsd(row.limit) : "no limit"}`}>
                  <div className={row.limit > 0 && row.spent >= row.limit ? "over" : ""} style={{ width: `${row.limit > 0 ? Math.min(100, (row.spent / row.limit) * 100) : 0}%` }} />
                </div>
                <span className="mono small">
                  {fmtUsd(row.spent)} / {row.limit > 0 ? fmtUsd(row.limit) : "∞"}
                </span>
              </div>
            ))}
            <small className="muted">
              Per-task limit {t.budget.effective.perTaskUsd > 0 ? fmtUsd(t.budget.effective.perTaskUsd) : "none"} · {t.totals.liveRequests} real API calls recorded · {t.totals.webFetches} page fetches · {t.totals.codeExecutions} sandbox runs
            </small>
            {t.budget.globalHold && <div className="error-box">Budget limit reached — new work is paused until it resets ({new Date(t.budget.resetsAt.day).toLocaleString()}).</div>}
          </section>

          {t.scheduleProjections.length > 0 && (
            <section className="card">
              <h3>Projected schedule costs</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Schedule</th>
                    <th>Runs/mo</th>
                    <th>Avg run</th>
                    <th>Per month</th>
                  </tr>
                </thead>
                <tbody>
                  {t.scheduleProjections.map((p) => (
                    <tr key={p.scheduleId}>
                      <td>{p.name}</td>
                      <td>{p.runsPerMonth}</td>
                      <td>{p.avgRunCostUsd === null ? "—" : fmtUsd(p.avgRunCostUsd)}</td>
                      <td>{p.projectedMonthlyUsd === null ? "after 1st run" : fmtUsd(p.projectedMonthlyUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}


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

const TIMEZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
})();

const CHECK_LABELS: Record<string, string> = {
  messages: "Basic Claude call",
  client_tools: "Tool use loop (delegation)",
  web_search: "Web search",
  web_fetch: "Web fetch",
  code_execution: "Code execution sandbox",
  agent_task: "End-to-end agent task",
};

interface BillingInfo {
  enabled: boolean;
  plans: { id: string; label: string; priceUsdMonthly: number; dailyUsd: number; monthlyUsd: number; perTaskUsd: number; concurrency: number; models: string[] }[];
  current: { plan: string; status: string | null; canRun: boolean; reason: string | null; warning: string | null; trialEndsAt: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean };
}

/** Plan, limits and Stripe checkout / portal (multi-user servers). */
function BillingCard() {
  const push = useTown((s) => s.pushToast);
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.billing().then(setInfo, (e) => push({ tone: "bad", text: errText(e) }));
  }, [push]);
  if (!info) {
    return (
      <section className="card">
        <h3>Plan & billing</h3>
        <p className="muted">Loading…</p>
      </section>
    );
  }
  const cur = info.current;
  const plan = info.plans.find((p) => p.id === cur.plan) ?? info.plans[0];
  const go = async (fn: () => Promise<{ url: string }>) => {
    setBusy(true);
    try {
      window.location.assign((await fn()).url);
    } catch (e) {
      push({ tone: "bad", text: errText(e) });
      setBusy(false);
    }
  };
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");
  const subscribed = !!cur.status && ["active", "trialing", "past_due"].includes(cur.status);
  return (
    <section className="card">
      <h3>Plan & billing</h3>
      {cur.reason && <div className="error-box">{cur.reason}</div>}
      {cur.warning && <div className="warn-box">{cur.warning}</div>}
      <dl className="kv">
        <dt>Plan</dt>
        <dd>
          <Badge tone={cur.canRun ? "good" : "bad"}>{plan.label}</Badge> {cur.status && <small className="muted">({cur.status.replace("_", " ")})</small>}
        </dd>
        {cur.plan === "trial" && (
          <>
            <dt>Trial ends</dt>
            <dd>{date(cur.trialEndsAt)}</dd>
          </>
        )}
        {cur.currentPeriodEnd && (
          <>
            <dt>{cur.cancelAtPeriodEnd ? "Ends" : "Renews"}</dt>
            <dd>{date(cur.currentPeriodEnd)}</dd>
          </>
        )}
        <dt>AI spend included</dt>
        <dd>
          {fmtUsd(plan.dailyUsd)}/day · {fmtUsd(plan.monthlyUsd)}/month · {fmtUsd(plan.perTaskUsd)}/task
        </dd>
        <dt>Villagers at once</dt>
        <dd>{plan.concurrency}</dd>
      </dl>
      {!info.enabled && <p className="muted small">Payments aren't set up on this server yet.</p>}
      {info.enabled && (
        <div className="row gap-s">
          {!subscribed &&
            info.plans
              .filter((p) => p.priceUsdMonthly > 0)
              .map((p) => (
                <button key={p.id} className="btn primary" disabled={busy} onClick={() => go(() => api.checkout(p.id))}>
                  {p.label} · ${p.priceUsdMonthly}/mo
                </button>
              ))}
          {subscribed && (
            <button className="btn" disabled={busy} onClick={() => go(api.billingPortal)}>
              Manage billing
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function SettingsPanel() {
  const theme = useTheme();
  const snap = useTown((s) => s.snapshot)!;
  const close = useTown((s) => s.openPanel);
  const push = useTown((s) => s.pushToast);
  const load = useTown((s) => s.load);
  const account = useTown((s) => s.account);
  const [townName, setTownName] = useState(snap.settings.townName);
  const [timezone, setTimezone] = useState(snap.settings.timezone);
  const [token, setTok] = useState(getToken());
  const [testing, setTesting] = useState(false);
  const st = snap.status;
  const b = st.budget;
  const [caps, setCaps] = useState({
    dailyUsd: b.soft.dailyUsd === null ? "" : String(b.soft.dailyUsd),
    monthlyUsd: b.soft.monthlyUsd === null ? "" : String(b.soft.monthlyUsd),
    perTaskUsd: b.soft.perTaskUsd === null ? "" : String(b.soft.perTaskUsd),
  });
  const save = async (patch: Parameters<typeof api.updateSettings>[0]) => {
    try {
      await api.updateSettings(patch);
      await load();
      push({ tone: "good", text: "Saved" });
    } catch (e) {
      push({ tone: "bad", text: errText(e) });
    }
  };
  const test = async () => {
    setTesting(true);
    try {
      const v = await api.testConnection();
      push({ tone: v.ok ? "good" : "bad", text: v.ok ? `Claude API reachable ✓ (${v.requestId})` : `Test failed: ${v.detail}` });
    } catch (e) {
      push({ tone: "bad", text: errText(e) });
    } finally {
      setTesting(false);
      void load();
    }
  };
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const limitText = (n: number) => (n > 0 ? fmtUsd(n) : "no limit");

  return (
    <Drawer side="left" title="Settings" icon={theme.ui.icons.settings} onClose={() => close(null)} wide>
      {account ? (
        <BillingCard />
      ) : (
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
          <dd>{st.provider.keyConfigured ? "Configured on the server (never sent to the browser)" : "Not set — add ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY_FILE) and restart"}</dd>
          {st.provider.baseUrlHost && (
            <>
              <dt>API host</dt>
              <dd>
                <Badge tone="warn">{st.provider.baseUrlHost}</Badge> <small className="muted">(from ANTHROPIC_BASE_URL)</small>
              </dd>
            </>
          )}
          <dt>Refusal fallback</dt>
          <dd>{st.provider.refusalFallback === "default" ? "Server-side default fallback (supported models)" : "Off"}</dd>
        </dl>
        <div className="row gap-s">
          <button className="btn primary" disabled={testing || st.provider.mode !== "live"} onClick={test}>
            {testing ? "Testing…" : "🔌 Test connection"}
          </button>
          <small className="muted">One tiny real call (~$0.01) with your default model. Full check: <code>npm run verify:live</code></small>
        </div>
        <h4>Live verification</h4>
        <table className="data-table">
          <thead>
            <tr>
              <th>Capability</th>
              <th>Result</th>
              <th>When</th>
              <th>Request id</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(CHECK_LABELS).map((id) => {
              const v = st.verifications.find((x) => x.checkId === id);
              return (
                <tr key={id} title={v?.detail}>
                  <td>{CHECK_LABELS[id]}</td>
                  <td>{v ? <Badge tone={v.ok ? "good" : "bad"}>{v.ok ? "PASS" : "FAIL"}</Badge> : <Badge tone="muted">never run</Badge>}</td>
                  <td>{v ? timeAgo(v.ts) : "—"}</td>
                  <td className="mono small">{v?.requestId ? v.requestId.slice(0, 18) + "…" : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted small">A capability counts as working only after a real API call proves it on this installation. Unverified rows have not been proven here.</p>
        </section>
      )}

      <section className="card">
        <h3>Workers (24/7 background processing)</h3>
        {!st.workers.length && <div className="warn-box">No worker has reported in. Tasks and schedules won't run until one starts.</div>}
        <ul className="task-mini">
          {st.workers.map((w) => (
            <li key={w.id}>
              <span>
                <i className={`dot ${w.alive ? "status-completed" : "status-failed"}`} /> {w.id} <small className="muted">
                  {w.role} · {w.hostname} · pid {w.pid} · up since {timeAgo(w.startedAt)}
                </small>
              </span>
              <span>{w.alive ? `${w.activeTasks} running` : `silent ${timeAgo(w.lastSeen)}`}</span>
            </li>
          ))}
        </ul>
        <small className="muted">This server runs as “{st.role}”. Limits: {st.limits.maxTurnsPerTask} model turns per task, delegation depth {st.limits.maxDelegationDepth}, schedules every ≥ {st.limits.minScheduleIntervalMinutes} min.</small>
      </section>

      <section className="card form">
        <h3>Budget limits</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th />
              <th>Spent</th>
              <th>Server ceiling</th>
              <th>Your limit</th>
              <th>Effective</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Today (UTC)</td>
              <td>{fmtUsd(b.spent.todayUsd)}</td>
              <td>{limitText(b.hard.dailyUsd)}</td>
              <td>
                <input type="number" min={0} step={0.5} placeholder="—" value={caps.dailyUsd} onChange={(e) => setCaps({ ...caps, dailyUsd: e.target.value })} />
              </td>
              <td>{limitText(b.effective.dailyUsd)}</td>
            </tr>
            <tr>
              <td>This month</td>
              <td>{fmtUsd(b.spent.monthUsd)}</td>
              <td>{limitText(b.hard.monthlyUsd)}</td>
              <td>
                <input type="number" min={0} step={1} placeholder="—" value={caps.monthlyUsd} onChange={(e) => setCaps({ ...caps, monthlyUsd: e.target.value })} />
              </td>
              <td>{limitText(b.effective.monthlyUsd)}</td>
            </tr>
            <tr>
              <td>Per task</td>
              <td>—</td>
              <td>{limitText(b.hard.perTaskUsd)}</td>
              <td>
                <input type="number" min={0} step={0.1} placeholder="—" value={caps.perTaskUsd} onChange={(e) => setCaps({ ...caps, perTaskUsd: e.target.value })} />
              </td>
              <td>{limitText(b.effective.perTaskUsd)}</td>
            </tr>
          </tbody>
        </table>
        <button className="btn" onClick={() => save({ budget: { dailyUsd: num(caps.dailyUsd), monthlyUsd: num(caps.monthlyUsd), perTaskUsd: num(caps.perTaskUsd) } })}>
          Save my limits
        </button>
        <small className="muted">
          Before every model call, the worst-case cost of that call is reserved; if it could cross any limit, the call doesn't start and the work pauses until the limit resets. Server ceilings come from the environment and can't be raised here. Per-villager caps are in each villager's Configure tab.
        </small>
        {b.globalHold && <div className="error-box">Budget limit reached — new work is paused.</div>}
        {b.agentHolds.length > 0 && <div className="warn-box">Paused by their own daily cap: {b.agentHolds.join(", ")}</div>}
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
        <fieldset>
          <legend>Town time zone</legend>
          <small className="muted">Drives the in-game clock and lighting, and is the default for new schedules.</small>
          <label className="check">
            <input type="radio" checked={snap.settings.timezoneMode === "auto"} onChange={() => save({ timezoneMode: "auto", timezone: browserTimezone() })} />
            <span>Follow this device ({browserTimezone()})</span>
          </label>
          <label className="check">
            <input type="radio" checked={snap.settings.timezoneMode === "manual"} onChange={() => save({ timezoneMode: "manual" })} />
            <span>Choose manually</span>
          </label>
          {snap.settings.timezoneMode === "manual" && (
            <div className="row gap-s">
              <input list="tz-list" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="e.g. Europe/London" />
              <datalist id="tz-list">
                {TIMEZONES.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
              <button className="btn" onClick={() => save({ timezone, timezoneMode: "manual" })}>
                Save
              </button>
            </div>
          )}
          <small className="muted">Current: {snap.settings.timezone}</small>
        </fieldset>
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
        <small className="muted">{theme.description} Themes change only visuals and sound — villagers, tasks and data stay the same.</small>
      </section>

      <section className="card">
        <h3>Skills</h3>
        <ul className="task-mini">
          {st.skills.map((sk) => (
            <li key={sk.id}>
              <span>
                <b>
                  {sk.icon} {sk.label}
                </b>{" "}
                <small className="muted">{sk.tools.map((t) => t.label).join(", ") || "model only"}</small>
              </span>
              <span className="row gap-s">
                {sk.status === "planned" ? <Badge tone="muted">planned</Badge> : <Badge tone="good">available</Badge>}
                {sk.tools.some((t) => t.requiresApproval) && <Badge tone="warn">approval</Badge>}
                {sk.tools.some((t) => t.implementation === "placeholder") && <Badge tone="muted">placeholder</Badge>}
              </span>
            </li>
          ))}
        </ul>
        <p className="muted small">There are no shell, file-system or open-network tools. Code runs only in Anthropic's isolated sandbox. Each villager can use only the skills enabled in its Configure tab, and the server enforces this.</p>
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
