import { useEffect, useState } from "react";
import { setToken } from "./api/client";
import { useTown } from "./state/store";
import { getTheme } from "./theme-engine/registry";
import { ThemeProvider } from "./theme-engine/ThemeContext";
import { World } from "./world/World";
import { AgentPanel } from "./ui/AgentPanel";
import { ActivityLog, ApprovalsPanel, BuildingPanel, NewProject, Projects, TaskBoard } from "./ui/Panels";
import { SettingsPanel, TreasuryPanel } from "./ui/Admin";
import { Dock, ProviderBanner, Toasts, TopBar, useSoundEffects } from "./ui/Hud";

function Hud() {
  useSoundEffects();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement)?.closest("input, textarea, select")) return;
      const s = useTown.getState();
      if (s.panel) s.openPanel(null);
      else s.selectAgent(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const panel = useTown((s) => s.panel);
  const agentId = useTown((s) => s.selectedAgentId);
  const buildingId = useTown((s) => s.selectedBuildingId);
  return (
    <>
      <TopBar />
      <ProviderBanner />
      {panel === "tasks" && <TaskBoard />}
      {panel === "new-project" && <NewProject />}
      {panel === "projects" && <Projects />}
      {panel === "log" && <ActivityLog />}
      {panel === "approvals" && <ApprovalsPanel />}
      {panel === "treasury" && <TreasuryPanel />}
      {panel === "settings" && <SettingsPanel />}
      {agentId && <AgentPanel agentId={agentId} />}
      {buildingId && !agentId && <BuildingPanel buildingId={buildingId} />}
      <Dock />
      <Toasts />
    </>
  );
}

function Gate({ error }: { error: string }) {
  const [token, setTok] = useState("");
  const load = useTown((s) => s.load);
  const needsToken = /401|Unauthorized/i.test(error);
  return (
    <div className="gate">
      <div className="panel gate-card">
        <h1>🏡 Agentopia</h1>
        {needsToken ? (
          <>
            <p>This town is protected. Enter the server's admin token.</p>
            <input type="password" value={token} onChange={(e) => setTok(e.target.value)} placeholder="AGENTOPIA_ADMIN_TOKEN" />
            <button
              className="btn primary full"
              onClick={() => {
                setToken(token);
                void load();
              }}
            >
              Enter town
            </button>
          </>
        ) : (
          <>
            <p>Can't reach the Agentopia server.</p>
            <pre className="error-box">{error}</pre>
            <p className="muted small">Start it with <code>npm run dev</code> and refresh.</p>
            <button className="btn full" onClick={() => void load()}>
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function App() {
  const snapshot = useTown((s) => s.snapshot);
  const loadError = useTown((s) => s.loadError);
  const load = useTown((s) => s.load);
  const connect = useTown((s) => s.connect);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!snapshot) return;
    return connect();
    // Connect once after the first successful load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!snapshot]);

  if (!snapshot) return loadError ? <Gate error={loadError} /> : <div className="loading">Waking up the village…</div>;
  const theme = getTheme(snapshot.settings.themeId);
  return (
    <ThemeProvider theme={theme}>
      <div className="app">
        <div className="world">
          <World theme={theme} />
        </div>
        <Hud />
      </div>
    </ThemeProvider>
  );
}
