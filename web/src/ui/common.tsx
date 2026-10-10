import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentStatus, EventType, SkillInfo, Task, TaskStatus, TownEvent } from "../../../shared/types";
import { useTown } from "../state/store";

export const fmtUsd = (n: number) => (n === 0 ? "$0.00" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
export const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Video-style log badges: START / STEP / SEND / DONE … */
export const EVENT_BADGE: Partial<Record<EventType, { label: string; tone: string }>> = {
  "task.created": { label: "NEW", tone: "info" },
  "task.unblocked": { label: "READY", tone: "info" },
  "task.started": { label: "START", tone: "accent" },
  "task.step": { label: "STEP", tone: "muted" },
  "task.progress": { label: "UPDATE", tone: "accent" },
  "task.message": { label: "YOU", tone: "info" },
  "task.tool_call": { label: "TOOL", tone: "accent2" },
  "task.handoff": { label: "SEND", tone: "accent2" },
  "task.approval_requested": { label: "ASK", tone: "warn" },
  "task.approval_resolved": { label: "DECIDE", tone: "warn" },
  "task.completed": { label: "DONE", tone: "good" },
  "task.failed": { label: "FAIL", tone: "bad" },
  "task.retry_scheduled": { label: "RETRY", tone: "warn" },
  "task.cancelled": { label: "STOP", tone: "muted" },
  "agent.updated": { label: "EDIT", tone: "info" },
  "agent.created": { label: "HIRE", tone: "good" },
  "agent.archived": { label: "LEFT", tone: "muted" },
  "building.created": { label: "BUILD", tone: "good" },
  "building.updated": { label: "BUILD", tone: "info" },
  "building.deleted": { label: "BUILD", tone: "muted" },
  "schedule.fired": { label: "SCHED", tone: "accent2" },
  "schedule.skipped": { label: "SKIP", tone: "warn" },
  "budget.hold": { label: "BUDGET", tone: "bad" },
  "system.verification": { label: "VERIFY", tone: "info" },
  "workflow.created": { label: "PROJECT", tone: "accent" },
  "workflow.completed": { label: "DELIVER", tone: "good" },
  "usage.recorded": { label: "COST", tone: "muted" },
  "system.notice": { label: "NOTE", tone: "info" },
};

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

export function EventBadge({ e }: { e: TownEvent }) {
  const b = EVENT_BADGE[e.type] ?? { label: e.type.split(".")[1]?.toUpperCase() ?? "EVENT", tone: "muted" };
  return <Badge tone={b.tone}>{b.label}</Badge>;
}

export const TASK_TONE: Record<TaskStatus, string> = {
  blocked: "muted",
  queued: "info",
  running: "accent",
  waiting_approval: "warn",
  retry_wait: "warn",
  completed: "good",
  failed: "bad",
  cancelled: "muted",
};

export const TASK_LABEL: Record<TaskStatus, string> = {
  blocked: "Waiting on others",
  queued: "Queued",
  running: "Running",
  waiting_approval: "Needs approval",
  retry_wait: "Retrying soon",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function StatusDot({ status }: { status: AgentStatus }) {
  return <span className={`dot status-${status}`} />;
}

export function SimTag({ on }: { on: boolean }) {
  return on ? (
    <span className="badge tone-warn" title="Produced by the offline simulator — no AI model was called">
      SIMULATED
    </span>
  ) : null;
}

export function Markdown({ text }: { text: string }) {
  // react-markdown never renders raw HTML, so model output cannot inject markup.
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Tables scroll sideways inside narrow panels instead of squashing.
          table: ({ children }) => (
            <div className="md-table">
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function Drawer({ side, title, icon, onClose, children, wide }: { side: "left" | "right"; title: ReactNode; icon?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <aside className={`drawer drawer-${side} ${wide ? "wide" : ""}`}>
      <header className="drawer-head">
        <h2>
          {icon && <span className="drawer-icon">{icon}</span>}
          {title}
        </h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      <div className="drawer-body">{children}</div>
    </aside>
  );
}

/** `plain` renders a non-interactive name (for use inside another button). */
export function AgentName({ id, plain }: { id: string | null; plain?: boolean }) {
  const agent = useTown((s) => s.snapshot?.agents.find((a) => a.id === id));
  const select = useTown((s) => s.selectAgent);
  if (!id) return <span className="muted">—</span>;
  if (id === "hiring-desk") return <span title="AI-written instruction drafts when hiring or rewriting an employee">🪄 Hiring desk (drafts)</span>;
  if (!agent) return <span>{id}</span>;
  if (plain) {
    return (
      <span className="agent-link">
        <span className="avatar-dot" style={{ background: agent.appearance.bodyColor }} />
        {agent.name}
      </span>
    );
  }
  return (
    <button className="link agent-link" onClick={() => select(agent.id)}>
      <span className="avatar-dot" style={{ background: agent.appearance.bodyColor }} />
      {agent.name}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Proof of execution: LIVE only when real Claude API request ids were recorded for the task. */
export function ExecutionBadge({ task, verbose }: { task: Task; verbose?: boolean }) {
  const e = task.execution;
  if (e.mode === "live") {
    return (
      <span className="badge tone-good" title={`Executed by the Claude API — ${e.calls} call(s), last request ${e.lastRequestId ?? "?"} · ${e.models.join(", ")}`}>
        LIVE{verbose ? ` · ${e.calls} call${e.calls === 1 ? "" : "s"} · ${fmtUsd(e.costUsd)}` : ""}
      </span>
    );
  }
  if (e.mode === "simulated" || task.simulated) return <SimTag on />;
  return null;
}

export function ExecutionProof({ task }: { task: Task }) {
  const e = task.execution;
  if (e.mode !== "live") return null;
  return (
    <div className="proof">
      ✅ Executed by the Claude API · {e.calls} call{e.calls === 1 ? "" : "s"} · {fmtTokens(e.inputTokens)} in / {fmtTokens(e.outputTokens)} out · ~{fmtUsd(e.costUsd)} · {e.models.join(", ")}
      <br />
      <span className="mono small">last request id: {e.lastRequestId}</span>
    </div>
  );
}

export function SkillChip({ skill }: { skill: SkillInfo }) {
  return (
    <span className={`skill-chip ${skill.status === "planned" ? "planned" : ""}`} title={skill.status === "planned" ? `${skill.label} — planned, not connected yet` : skill.description}>
      {skill.icon} {skill.label}
      {skill.status === "planned" && <em> · planned</em>}
    </span>
  );
}
