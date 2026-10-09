/**
 * Container healthcheck.
 *   api / all : GET /api/health on the local port
 *   worker    : this host has a worker heartbeat younger than 30s in the database
 * Exit 0 = healthy, 1 = unhealthy.
 */
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "./config.js";

const config = loadConfig();

async function main(): Promise<boolean> {
  if (config.role === "worker") {
    const db = new DatabaseSync(config.dbPath, { readOnly: true });
    const row = db.prepare("SELECT MAX(last_seen) AS t FROM workers WHERE hostname = ?").get(os.hostname()) as { t: string | null };
    db.close();
    return !!row.t && Date.now() - Date.parse(row.t) < 30_000;
  }
  const res = await fetch(`http://127.0.0.1:${config.port}/api/health`);
  return res.ok;
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  () => process.exit(1),
);
