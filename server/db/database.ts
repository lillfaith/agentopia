import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defaultAppearance, defaultVoice } from "../../shared/cosmetics.js";
import { SEED_LOOKS } from "../agents/looks.js";

/**
 * Schema migrations, applied in order and tracked with PRAGMA user_version.
 * Append new migrations; never edit a shipped one.
 */
export type Migration = string | ((db: DatabaseSync) => void);

export const MIGRATIONS: Migration[] = [
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

  /* 2 — Phase 2: skills, budgets, schedules, workers, proof of execution */ `
  ALTER TABLE agents ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE agents ADD COLUMN daily_budget_usd REAL;
  ALTER TABLE agents ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE usage ADD COLUMN request_id TEXT;
  ALTER TABLE usage ADD COLUMN requested_model TEXT;
  ALTER TABLE usage ADD COLUMN web_fetch_requests INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE usage ADD COLUMN code_executions INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX idx_usage_task ON usage(task_id);

  ALTER TABLE tasks ADD COLUMN schedule_id TEXT;
  ALTER TABLE workflows ADD COLUMN schedule_id TEXT;

  CREATE UNIQUE INDEX idx_buildings_slot ON buildings(slot);

  CREATE TABLE schedules (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    enabled          INTEGER NOT NULL DEFAULT 1,
    cadence          TEXT NOT NULL,
    timezone         TEXT NOT NULL,
    target           TEXT NOT NULL,
    overlap          TEXT NOT NULL DEFAULT 'skip',
    next_run_at      TEXT,
    last_run_at      TEXT,
    last_outcome     TEXT,
    last_task_id     TEXT,
    last_workflow_id TEXT,
    run_count        INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );
  CREATE INDEX idx_schedules_due ON schedules(enabled, next_run_at);

  CREATE TABLE workers (
    id           TEXT PRIMARY KEY,
    role         TEXT NOT NULL,
    hostname     TEXT NOT NULL,
    pid          INTEGER NOT NULL,
    started_at   TEXT NOT NULL,
    last_seen    TEXT NOT NULL,
    active_tasks INTEGER NOT NULL DEFAULT 0
  );

  -- Results of side-effecting local tool calls, so a crash-recovered task never runs one twice.
  CREATE TABLE tool_runs (
    task_id     TEXT NOT NULL,
    tool_use_id TEXT NOT NULL,
    tool_id     TEXT NOT NULL,
    result      TEXT NOT NULL,
    is_error    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (task_id, tool_use_id)
  );

  CREATE TABLE verifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         TEXT NOT NULL,
    check_id   TEXT NOT NULL,
    ok         INTEGER NOT NULL,
    detail     TEXT NOT NULL,
    request_id TEXT,
    model      TEXT,
    cost_usd   REAL NOT NULL DEFAULT 0,
    source     TEXT NOT NULL
  );
  CREATE INDEX idx_verifications_check ON verifications(check_id, id);
  `,

  /* 3 — map Phase 1 tool allowlists onto skills */ (db) => {
    const TOOL_TO_SKILL: Record<string, string> = {
      delegate_task: "delegation",
      web_search: "research",
      publish_content: "publishing",
      send_email: "email",
    };
    const rows = db.prepare("SELECT id, tools FROM agents").all() as { id: string; tools: string }[];
    for (const r of rows) {
      let tools: string[] = [];
      try {
        tools = JSON.parse(r.tools);
      } catch {
        /* keep empty */
      }
      const skills = new Set<string>(["writing"]);
      for (const t of tools) if (TOOL_TO_SKILL[t]) skills.add(TOOL_TO_SKILL[t]);
      db.prepare("UPDATE agents SET skills = ? WHERE id = ?").run(JSON.stringify([...skills]), r.id);
    }
  },

  /* 4 — cosmetic identity: appearance (body, face, features, wearables) and voice */ (db) => {
    db.exec("ALTER TABLE agents ADD COLUMN appearance TEXT");
    db.exec("ALTER TABLE agents ADD COLUMN voice TEXT");
    const OLD_ACCESSORY: Record<string, string> = { crown: "crown", beret: "beret", goggles: "goggles", sprout: "sprout" };
    const rows = db.prepare("SELECT id, avatar FROM agents").all() as { id: string; avatar: string }[];
    for (const r of rows) {
      let avatar = { color: "#f6a5c0", accessory: "none" };
      try {
        avatar = { ...avatar, ...JSON.parse(r.avatar) };
      } catch {
        /* keep default */
      }
      const seeded = SEED_LOOKS[r.id];
      const appearance = seeded?.appearance ?? defaultAppearance(avatar.color, OLD_ACCESSORY[avatar.accessory]);
      const voice = seeded?.voice ?? defaultVoice();
      db.prepare("UPDATE agents SET appearance = ?, voice = ? WHERE id = ?").run(JSON.stringify(appearance), JSON.stringify(voice), r.id);
    }
  },

  /* 5 — projects: a goal that groups tasks and workflows */ `
  CREATE TABLE projects (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    goal       TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects(id);
  ALTER TABLE workflows ADD COLUMN project_id TEXT REFERENCES projects(id);
  CREATE INDEX idx_tasks_project ON tasks(project_id, created_at);
  `,

  /* 6 — rewards: append-only coin ledger, owned cosmetics, achievements */ `
  CREATE TABLE coin_ledger (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT NOT NULL,
    amount       INTEGER NOT NULL,
    reason       TEXT NOT NULL,
    -- idempotency key: one entry per task reward, achievement or purchase
    ref          TEXT NOT NULL UNIQUE,
    kind         TEXT NOT NULL,
    content_key  TEXT
  );
  CREATE INDEX idx_coin_ledger_kind ON coin_ledger(kind, ts);
  CREATE INDEX idx_coin_ledger_content ON coin_ledger(content_key, ts);

  CREATE TABLE owned_items (
    item_id      TEXT PRIMARY KEY,
    acquired_at  TEXT NOT NULL
  );

  CREATE TABLE achievements (
    id           TEXT PRIMARY KEY,
    unlocked_at  TEXT NOT NULL
  );
  `,

  /* 7 — agent memory: short notes an agent keeps between tasks (owner-visible, deletable) */ (db) => {
    db.exec(`
      CREATE TABLE agent_memories (
        id              TEXT PRIMARY KEY,
        agent_id        TEXT NOT NULL REFERENCES agents(id),
        content         TEXT NOT NULL,
        source_task_id  TEXT,
        created_at      TEXT NOT NULL
      );
      CREATE INDEX idx_agent_memories_agent ON agent_memories(agent_id, created_at);
    `);
    // Every existing villager gets the memory skill.
    const rows = db.prepare("SELECT id, skills FROM agents").all() as { id: string; skills: string }[];
    for (const r of rows) {
      let skills: string[] = [];
      try {
        skills = JSON.parse(r.skills);
      } catch {
        /* keep empty */
      }
      if (!skills.includes("memory")) db.prepare("UPDATE agents SET skills = ? WHERE id = ?").run(JSON.stringify([...skills, "memory"]), r.id);
    }
  },

  /* 8 — cost controls: per-task research depth and model choice, richer usage records */ `
  ALTER TABLE tasks ADD COLUMN depth TEXT;
  ALTER TABLE tasks ADD COLUMN model_override TEXT;
  ALTER TABLE usage ADD COLUMN thinking_tokens INTEGER;
  ALTER TABLE usage ADD COLUMN server_iterations INTEGER;
  ALTER TABLE usage ADD COLUMN context_tokens INTEGER;
  `,

  /* 9 — chat: every task is a conversation the owner can reply to; free-form chats are tasks of kind "chat" */ `
  ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'task';
  CREATE TABLE task_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    -- Owner messages wait here until the villager picks them up (1 = already in its conversation).
    consumed    INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX idx_task_messages_task ON task_messages(task_id, id);
  `,

  /* 10 — owners' own API keys (encrypted) and per-villager AI provider */ `
  CREATE TABLE credentials (
    id             TEXT PRIMARY KEY,
    service        TEXT NOT NULL,
    label          TEXT NOT NULL,
    secret         TEXT NOT NULL,
    hint           TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'unchecked',
    status_detail  TEXT,
    models         TEXT NOT NULL DEFAULT '[]',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    last_used_at   TEXT
  );
  ALTER TABLE agents ADD COLUMN provider TEXT NOT NULL DEFAULT 'anthropic';
  ALTER TABLE agents ADD COLUMN credential_id TEXT;
  ALTER TABLE agents ADD COLUMN github_credential_id TEXT;
  ALTER TABLE agents ADD COLUMN custom_prices TEXT;
  ALTER TABLE usage ADD COLUMN billing TEXT NOT NULL DEFAULT 'platform';
  `,
];

export type Database = DatabaseSync;

export function openDatabase(dbPath: string, migrations: Migration[] = MIGRATIONS): Database {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  migrate(db, migrations);
  return db;
}

function migrate(db: Database, migrations: Migration[]): void {
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (current > migrations.length) throw new Error(`Database schema v${current} is newer than this build (v${migrations.length}); refusing to open it.`);
  for (let v = current; v < migrations.length; v++) {
    const m = migrations[v];
    transaction(db, () => {
      if (typeof m === "string") db.exec(m);
      else m(db);
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
