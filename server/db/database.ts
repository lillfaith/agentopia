import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Schema migrations, applied in order and tracked with PRAGMA user_version.
 * Append new migrations; never edit a shipped one.
 */
const MIGRATIONS: string[] = [
  /* 1 — Phase 1 foundation */ `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE buildings (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    department  TEXT NOT NULL,
    kind        TEXT NOT NULL,
    slot        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE agents (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    role             TEXT NOT NULL,
    personality      TEXT NOT NULL DEFAULT '',
    system_prompt    TEXT NOT NULL,
    responsibilities TEXT NOT NULL DEFAULT '[]',
    model            TEXT NOT NULL,
    effort           TEXT NOT NULL DEFAULT 'medium',
    tools            TEXT NOT NULL DEFAULT '[]',
    avatar           TEXT NOT NULL DEFAULT '{}',
    building_id      TEXT NOT NULL REFERENCES buildings(id),
    status           TEXT NOT NULL DEFAULT 'idle',
    status_detail    TEXT,
    current_task_id  TEXT,
    enabled          INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );

  CREATE TABLE workflows (
    id            TEXT PRIMARY KEY,
    template      TEXT NOT NULL,
    title         TEXT NOT NULL,
    input         TEXT NOT NULL DEFAULT '{}',
    status        TEXT NOT NULL,
    final_task_id TEXT,
    created_at    TEXT NOT NULL,
    completed_at  TEXT
  );

  CREATE TABLE tasks (
    id               TEXT PRIMARY KEY,
    title            TEXT NOT NULL,
    instructions     TEXT NOT NULL,
    agent_id         TEXT NOT NULL REFERENCES agents(id),
    status           TEXT NOT NULL,
    priority         INTEGER NOT NULL DEFAULT 1,
    depends_on       TEXT NOT NULL DEFAULT '[]',
    parent_task_id   TEXT,
    workflow_id      TEXT REFERENCES workflows(id),
    created_by       TEXT NOT NULL,
    delegation_depth INTEGER NOT NULL DEFAULT 0,
    attempts         INTEGER NOT NULL DEFAULT 0,
    max_attempts     INTEGER NOT NULL DEFAULT 3,
    last_error       TEXT,
    output           TEXT,
    run_after        TEXT,
    lease_owner      TEXT,
    lease_until      TEXT,
    conversation     TEXT,
    simulated        INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    started_at       TEXT,
    completed_at     TEXT,
    updated_at       TEXT NOT NULL
  );
  CREATE INDEX idx_tasks_status ON tasks(status, priority DESC, created_at);
  CREATE INDEX idx_tasks_agent ON tasks(agent_id, status);
  CREATE INDEX idx_tasks_workflow ON tasks(workflow_id);

  CREATE TABLE approvals (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES tasks(id),
    agent_id    TEXT NOT NULL REFERENCES agents(id),
    tool_id     TEXT NOT NULL,
    tool_use_id TEXT NOT NULL,
    summary     TEXT NOT NULL,
    input       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    decided_at  TEXT,
    note        TEXT,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX idx_approvals_status ON approvals(status);

  CREATE TABLE events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        TEXT NOT NULL,
    type      TEXT NOT NULL,
    agent_id  TEXT,
    task_id   TEXT,
    message   TEXT NOT NULL,
    data      TEXT NOT NULL DEFAULT '{}',
    simulated INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_events_agent ON events(agent_id, id);
  CREATE INDEX idx_events_task ON events(task_id, id);

  CREATE TABLE usage (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    ts                  TEXT NOT NULL,
    agent_id            TEXT NOT NULL,
    task_id             TEXT,
    model               TEXT NOT NULL,
    input_tokens        INTEGER NOT NULL DEFAULT 0,
    output_tokens       INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
    web_search_requests INTEGER NOT NULL DEFAULT 0,
    cost_usd            REAL NOT NULL DEFAULT 0,
    simulated           INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_usage_ts ON usage(ts);
  CREATE INDEX idx_usage_agent ON usage(agent_id);
  `,
];

export type Database = DatabaseSync;

export function openDatabase(dbPath: string): Database {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: Database): void {
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Run `fn` inside BEGIN IMMEDIATE so concurrent worker processes serialise writes. */
export function transaction<T>(db: Database, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
