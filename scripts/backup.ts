/**
 * npm run backup [-- <output-file>]
 * In AGENTOPIA_MODE=saas it backs up accounts.sqlite and every town instead.
 * Consistent online backup of the town database (safe while the server and
 * workers are running) using SQLite's VACUUM INTO. Default output:
 * ./data/backups/agentopia-<timestamp>.sqlite
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "../server/config.js";
import { backupSaas } from "../server/saas/backup.js";

const config = loadConfig();
if (config.mode === "saas") {
  // Multi-user: the accounts database plus every town, into <data>/backups/<timestamp>/.
  const b = backupSaas(config.dataDir, config.backupKeep);
  console.log(`✓ Backup of ${b.files} database(s) written to ${b.dir} (${(b.bytes / 1024).toFixed(0)} KB, integrity ok); keeping the newest ${config.backupKeep}`);
  process.exit(0);
}
if (!fs.existsSync(config.dbPath)) {
  console.error(`No database at ${config.dbPath}`);
  process.exit(1);
}
const out = path.resolve(process.argv[2] ?? path.join(path.dirname(config.dbPath), "backups", `agentopia-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`));
fs.mkdirSync(path.dirname(out), { recursive: true });
if (fs.existsSync(out)) {
  console.error(`Refusing to overwrite ${out}`);
  process.exit(1);
}
const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA busy_timeout = 5000");
db.prepare("VACUUM INTO ?").run(out);
db.close();
const check = new DatabaseSync(out, { readOnly: true });
const { n } = check.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number };
const ok = (check.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
check.close();
console.log(`✓ Backup written to ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${n} tasks, integrity: ${ok})`);
