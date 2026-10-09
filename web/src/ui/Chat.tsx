import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Agent, ResearchDepth, Task, TaskMessage } from "../../../shared/types";
import { DEMO, api } from "../api/client";
import { useTown } from "../state/store";
import { Markdown, TASK_LABEL, timeAgo } from "./common";
import { TaskRunOptions } from "./Usage";

const WORKING = new Set(["queued", "running", "blocked", "retry_wait", "waiting_approval"]);
const LIVE = new Set(["task.progress", "task.step", "task.tool_call", "task.approval_requested", "task.retry_scheduled", "budget.hold"]);

/** Messages for a thread; rebuilt from the task itself when the server can't be asked (demo mode). */
function useThread(task: Task | undefined): TaskMessage[] {
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  useEffect(() => {
    if (!task) return setMessages([]);
    const fallback = (): TaskMessage[] => [
      { id: 0, taskId: task.id, role: "brief", content: task.instructions, createdAt: task.createdAt },
      ...(task.output ? [{ id: 0, taskId: task.id, role: "agent" as const, content: task.output, createdAt: task.completedAt ?? task.updatedAt }] : []),
    ];
    if (DEMO) return setMessages(fallback());
    let live = true;
    api.taskMessages(task.id).then(
      (m) => live && setMessages(m),
      () => live && setMessages(fallback()),
    );
    return () => {
      live = false;
    };
    // Refetch whenever the task changes state (a new reply lands, or work starts).
  }, [task?.id, task?.status, task?.updatedAt]);
  return messages;
}

/**
 * Talk to a villager like a chat assistant: reply to any finished task to refine it (the villager
 * keeps everything it found) or start a free-form chat. Every answer stays in the thread.
 */
export function Chat({ agent }: { agent: Agent }) {
  const request = useTown((s) => s.chatRequest);
  const threads = useTown(useShallow((s) => s.snapshot!.tasks.filter((t) => t.agentId === agent.id)));
  const sorted = useMemo(() => [...threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [threads]);
  const [threadId, setThreadId] = useState<string | null>(() => (request?.agentId === agent.id ? request.taskId : (sorted[0]?.id ?? null)));
  useEffect(() => {
    if (request?.agentId === agent.id) setThreadId(request.taskId);
  }, [request?.nonce]);
  const task = threads.find((t) => t.id === threadId);

  return (
    <div className="chat">
      <div className="chat-bar">
        <select value={threadId ?? ""} onChange={(e) => setThreadId(e.target.value || null)} aria-label="Conversation">
          <option value="">✏️ New chat with {agent.name}</option>
          {sorted.map((t) => (
            <option key={t.id} value={t.id}>
              {t.kind === "chat" ? "💬" : "📋"} {t.title}
            </option>
          ))}
        </select>
        {threadId && (
          <button className="btn ghost" onClick={() => setThreadId(null)}>
            New chat
          </button>
        )}
      </div>
      {task ? <Thread task={task} agent={agent} /> : <NewChat agent={agent} onStarted={setThreadId} />}
    </div>
  );
}

function Thread({ task, agent }: { task: Task; agent: Agent }) {
  const messages = useThread(task);
  const working = WORKING.has(task.status);
  const lastOwnerAt = [...messages].reverse().find((m) => m.role !== "agent")?.createdAt ?? task.createdAt;
  const live = useTown(
    useShallow((s) => (working ? s.snapshot!.events.filter((e) => e.taskId === task.id && LIVE.has(e.type) && e.ts >= lastOwnerAt).slice(-8) : [])),
  );
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, live.length]);
  const agentReplies = messages.filter((m) => m.role === "agent").length;

  return (
    <>
      <div className="chat-log" ref={scroller} aria-live="polite">
        {messages.map((m, i) => (
          <Bubble key={`${m.id}-${i}`} m={m} task={task} agent={agent} version={m.role === "agent" && agentReplies > 1 ? messages.slice(0, i + 1).filter((x) => x.role === "agent").length : null} />
        ))}
        {working && (
          <div className="bubble agent typing">
            <span className="who">{agent.name}</span>
            {task.status === "waiting_approval" ? (
              <button className="btn warn" onClick={() => useTown.getState().openPanel("approvals")}>
                🔔 Waiting for your approval
              </button>
            ) : live.length ? (
              <ul className="work-feed">
                {live.map((e) => (
                  <li key={e.id} className={e.type === "task.progress" ? "note" : "step"}>
                    {e.message}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="dots" aria-label={`${agent.name} is ${TASK_LABEL[task.status].toLowerCase()}`}>
                <i />
                <i />
                <i />
              </span>
            )}
          </div>
        )}
        {task.status === "failed" && task.lastError && (
          <div className="error-box">
            {task.lastError}
            <button className="btn ghost" onClick={() => api.retryTask(task.id).catch((e) => useTown.getState().pushToast({ tone: "bad", text: String(e) }))}>
              Try again
            </button>
          </div>
        )}
      </div>
      <Composer
        disabled={working}
        placeholder={working ? `${agent.name} is working on it…` : task.kind === "chat" ? `Message ${agent.name}…` : `Ask ${agent.name} to change or explain this work…`}
        onSend={async (text) => {
          await api.replyToTask(task.id, text);
          await useTown.getState().load();
        }}
      />
    </>
  );
}

function Bubble({ m, task, agent, version }: { m: TaskMessage; task: Task; agent: Agent; version: number | null }) {
  const push = useTown((s) => s.pushToast);
  if (m.role === "agent") {
    return (
      <div className="bubble agent">
        <span className="who">
          {agent.name}
          {version ? <em> · version {version}</em> : null}
          <small className="muted"> {timeAgo(m.createdAt)}</small>
        </span>
        <div className="result-body">
          <Markdown text={m.content} />
        </div>
        <button className="btn ghost tiny" onClick={() => navigator.clipboard?.writeText(m.content).then(() => push({ tone: "info", text: "Copied" }), () => {})}>
          Copy
        </button>
      </div>
    );
  }
  const label = m.role === "brief" ? (task.kind === "chat" ? "You" : task.createdBy === "user" ? "Task you assigned" : "Task brief") : "You";
  return (
    <div className="bubble owner">
      <span className="who">
        {label}
        <small className="muted"> {timeAgo(m.createdAt)}</small>
      </span>
      {m.role === "brief" && task.kind !== "chat" && <b className="brief-title">{task.title}</b>}
      <div className="owner-text">{m.content}</div>
    </div>
  );
}

function NewChat({ agent, onStarted }: { agent: Agent; onStarted: (taskId: string) => void }) {
  const [run, setRun] = useState<{ depth: ResearchDepth | ""; model: string }>({ depth: "", model: "" });
  return (
    <>
      <div className="chat-log empty-chat">
        <p className="muted">
          Chat with {agent.name} like you would with an assistant. Ask questions, think out loud, or get help with something quick. To refine finished work, pick
          that task above and reply to it: {agent.name} keeps everything they found.
        </p>
        <details>
          <summary className="muted small">Options</summary>
          <TaskRunOptions agent={agent} depth={run.depth} model={run.model} onChange={setRun} />
        </details>
      </div>
      <Composer
        placeholder={`Message ${agent.name}…`}
        onSend={async (text) => {
          const t = await api.startChat({ agentId: agent.id, text, depth: run.depth || null, modelOverride: run.model || null });
          await useTown.getState().load();
          onStarted(t.id);
        }}
      />
    </>
  );
}

function Composer({ onSend, disabled, placeholder }: { onSend: (text: string) => Promise<void>; disabled?: boolean; placeholder: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const t = text.trim();
    if (!t || busy || disabled) return;
    setBusy(true);
    try {
      await onSend(t);
      setText("");
    } catch (e) {
      useTown.getState().pushToast({ tone: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="chat-compose">
      <textarea
        value={text}
        rows={2}
        maxLength={20000}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <button className="btn primary" disabled={disabled || busy || !text.trim()} onClick={send}>
        Send
      </button>
    </div>
  );
}
