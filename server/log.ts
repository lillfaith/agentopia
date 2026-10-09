/**
 * Structured logging and error reporting.
 *
 * In production every line is one JSON object (time, level, msg, fields), which
 * Railway and most log stores index directly. In development it stays readable.
 * Errors can also be pushed to AGENTOPIA_ERROR_WEBHOOK_URL (Slack/Discord/any
 * HTTP collector): one POST per distinct message per 10 minutes, never with
 * request bodies, secrets or user content beyond the error message itself.
 */
type Level = "info" | "warn" | "error";

const json = process.env.NODE_ENV === "production" || process.env.AGENTOPIA_LOG_FORMAT === "json";
const webhook = process.env.AGENTOPIA_ERROR_WEBHOOK_URL?.trim() || null;
const lastReported = new Map<string, number>();
const REPORT_EVERY_MS = 10 * 60_000;

function describe(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  return { message: String(err) };
}

function write(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (json) {
    const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
    (level === "error" ? process.stderr : process.stdout).write(line + "\n");
  } else {
    const extra = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : "";
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(`[${level}] ${msg}${extra}`);
  }
}

async function report(msg: string, error: { message: string; stack?: string }, fields: Record<string, unknown>): Promise<void> {
  if (!webhook) return;
  const key = `${msg}:${error.message}`.slice(0, 300);
  const now = Date.now();
  if (now - (lastReported.get(key) ?? 0) < REPORT_EVERY_MS) return;
  lastReported.set(key, now);
  try {
    const text = `🚨 Agentopia error: ${msg}\n${error.message}${fields.scope ? `\nscope: ${String(fields.scope)}` : ""}`;
    await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, content: text, level: "error", msg, error: error.message, ...fields }), signal: AbortSignal.timeout(5000) });
  } catch {
    /* reporting must never take the server down */
  }
}

export const log = {
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error(msg: string, err?: unknown, fields: Record<string, unknown> = {}): void {
    const e = err === undefined ? { message: msg } : describe(err);
    write("error", msg, { ...fields, error: e.message, stack: e.stack });
    void report(msg, e, fields);
  },
};

/** Last-resort handlers: log and report, then keep serving (unhandled rejections) or exit (uncaught exceptions). */
export function installProcessHandlers(): void {
  process.on("unhandledRejection", (reason) => log.error("Unhandled promise rejection", reason, { scope: "process" }));
  process.on("uncaughtException", (err) => {
    log.error("Uncaught exception — exiting so the platform restarts the process", err, { scope: "process" });
    setTimeout(() => process.exit(1), 1000).unref();
  });
}
