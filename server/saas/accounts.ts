import { createHash, randomBytes, randomUUID } from "node:crypto";
import { openDatabase, transaction, type Database, type Migration } from "../db/database.js";
import { TRIAL_DAYS } from "./plans.js";

/**
 * The central accounts database: users, sessions, the town registry and the
 * account audit log. Each user's world lives in its own town database file;
 * this database never holds town content.
 */
export const ACCOUNT_MIGRATIONS: Migration[] = [
  /* 1 — accounts, sessions, towns, audit log */ `
  CREATE TABLE users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash   TEXT NOT NULL,
    plan            TEXT NOT NULL DEFAULT 'trial',
    trial_ends_at   TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE towns (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    -- When the worker should next open this town (queued work, retries, schedules). NULL = nothing pending.
    wake_at     TEXT,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX idx_towns_wake ON towns(wake_at) WHERE wake_at IS NOT NULL;

  CREATE TABLE sessions (
    token_hash    TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    ip            TEXT,
    user_agent    TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

  CREATE TABLE audit_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       TEXT NOT NULL,
    user_id  TEXT,
    action   TEXT NOT NULL,
    ip       TEXT,
    detail   TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX idx_audit_user ON audit_log(user_id, id);
  `,

  /* 2 — model spend per user per UTC day (operator-wide cap, cost reporting) */ `
  CREATE TABLE usage_daily (
    day       TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    cost_usd  REAL NOT NULL DEFAULT 0,
    calls     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, user_id)
  );
  `,
];

export interface Account {
  id: string;
  email: string;
  plan: string;
  trialEndsAt: string | null;
  status: "active" | "suspended";
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  ts: string;
  action: string;
  ip: string | null;
  detail: Record<string, unknown>;
}

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function toAccount(r: Row): Account {
  return {
    id: r.id as string,
    email: r.email as string,
    plan: r.plan as string,
    trialEndsAt: (r.trial_ends_at as string) ?? null,
    status: r.status as Account["status"],
    createdAt: r.created_at as string,
  };
}

export class AccountsStore {
  constructor(readonly db: Database) {}

  static open(path: string): AccountsStore {
    return new AccountsStore(openDatabase(path, ACCOUNT_MIGRATIONS));
  }

  // ── users ──

  /** Create a user and their town in one transaction. Returns null if the email is taken. */
  createUser(email: string, passwordHash: string): { account: Account; townId: string } | null {
    const id = randomUUID();
    const townId = randomUUID();
    const ts = now();
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString();
    try {
      transaction(this.db, () => {
        this.db
          .prepare("INSERT INTO users (id, email, password_hash, plan, trial_ends_at, status, created_at, updated_at) VALUES (?, ?, ?, 'trial', ?, 'active', ?, ?)")
          .run(id, email, passwordHash, trialEndsAt, ts, ts);
        this.db.prepare("INSERT INTO towns (id, user_id, wake_at, created_at) VALUES (?, ?, NULL, ?)").run(townId, id, ts);
      });
    } catch (err) {
      if (String(err).includes("UNIQUE")) return null;
      throw err;
    }
    return { account: this.getUser(id)!, townId };
  }

  getUser(id: string): Account | null {
    const r = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
    return r ? toAccount(r) : null;
  }

  findByEmail(email: string): { account: Account; passwordHash: string } | null {
    const r = this.db.prepare("SELECT * FROM users WHERE email = ?").get(email) as Row | undefined;
    return r ? { account: toAccount(r), passwordHash: r.password_hash as string } : null;
  }

  setPlan(userId: string, plan: string): void {
    this.db.prepare("UPDATE users SET plan = ?, updated_at = ? WHERE id = ?").run(plan, now(), userId);
  }

  setTrialEnd(userId: string, iso: string | null): void {
    this.db.prepare("UPDATE users SET trial_ends_at = ?, updated_at = ? WHERE id = ?").run(iso, now(), userId);
  }

  // ── towns ──

  townOf(userId: string): string | null {
    const r = this.db.prepare("SELECT id FROM towns WHERE user_id = ?").get(userId) as { id: string } | undefined;
    return r?.id ?? null;
  }

  ownerOf(townId: string): string | null {
    const r = this.db.prepare("SELECT user_id FROM towns WHERE id = ?").get(townId) as { user_id: string } | undefined;
    return r?.user_id ?? null;
  }

  setWake(townId: string, at: string | null): void {
    this.db.prepare("UPDATE towns SET wake_at = ? WHERE id = ?").run(at, townId);
  }

  /** Towns whose wake time has passed. */
  dueTowns(nowIso: string, limit = 50): string[] {
    return (this.db.prepare("SELECT id FROM towns WHERE wake_at IS NOT NULL AND wake_at <= ? ORDER BY wake_at LIMIT ?").all(nowIso, limit) as { id: string }[]).map((r) => r.id);
  }

  // ── sessions ──

  /** Create a session; returns the raw token (only its hash is stored). */
  createSession(userId: string, ttlMs: number, meta: { ip: string | null; userAgent: string | null }): { token: string; expiresAt: string } {
    const token = randomBytes(32).toString("base64url");
    const ts = now();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    this.db
      .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(sha256(token), userId, ts, expiresAt, ts, meta.ip, meta.userAgent?.slice(0, 300) ?? null);
    return { token, expiresAt };
  }

  /** Resolve a session token to its active user, sliding the expiry forward at most once a minute. */
  resolveSession(token: string, ttlMs: number): { account: Account; expiresAt: string; renewed: boolean } | null {
    const hash = sha256(token);
    const r = this.db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(hash) as Row | undefined;
    if (!r) return null;
    if ((r.expires_at as string) <= now()) {
      this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
      return null;
    }
    const account = this.getUser(r.user_id as string);
    if (!account || account.status !== "active") return null;
    let expiresAt = r.expires_at as string;
    let renewed = false;
    if (Date.now() - new Date(r.last_seen_at as string).getTime() > 60_000) {
      expiresAt = new Date(Date.now() + ttlMs).toISOString();
      this.db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?").run(now(), expiresAt, hash);
      renewed = true;
    }
    return { account, expiresAt, renewed };
  }

  deleteSession(token: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  }

  deleteAllSessions(userId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  pruneSessions(): number {
    return Number(this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now()).changes);
  }

  // ── usage ──

  addUsage(userId: string, costUsd: number, at = new Date()): void {
    this.db
      .prepare("INSERT INTO usage_daily (day, user_id, cost_usd, calls) VALUES (?, ?, ?, 1) ON CONFLICT(day, user_id) DO UPDATE SET cost_usd = cost_usd + excluded.cost_usd, calls = calls + 1")
      .run(at.toISOString().slice(0, 10), userId, costUsd);
  }

  /** Total model spend across all users on a UTC day. */
  spendOn(day: string): number {
    return Number((this.db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM usage_daily WHERE day = ?").get(day) as { c: number }).c);
  }

  // ── audit ──

  audit(userId: string | null, action: string, ip: string | null, detail: Record<string, unknown> = {}): void {
    this.db.prepare("INSERT INTO audit_log (ts, user_id, action, ip, detail) VALUES (?, ?, ?, ?, ?)").run(now(), userId, action, ip, JSON.stringify(detail));
  }

  auditFor(userId: string, limit = 100): AuditEntry[] {
    return (this.db.prepare("SELECT * FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT ?").all(userId, limit) as Row[]).map((r) => ({
      id: Number(r.id),
      ts: r.ts as string,
      action: r.action as string,
      ip: (r.ip as string) ?? null,
      detail: JSON.parse((r.detail as string) || "{}"),
    }));
  }
}
