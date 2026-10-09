/**
 * npm run migrate — apply pending schema migrations now, instead of on first use.
 * Run it as a pre-deploy step: it fails loudly (exit 1) if any database can't
 * be migrated, before the new version starts serving.
 *   local mode: the single town database (AGENTOPIA_DB_PATH)
 *   saas mode:  accounts.sqlite and every town in AGENTOPIA_DATA_DIR/towns
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../server/config.js";
import { MIGRATIONS, openDatabase } from "../server/db/database.js";
import { ACCOUNT_MIGRATIONS } from "../server/saas/accounts.js";

const config = loadConfig();

// Fail early with a clear message if the data volume isn't writable (Railway volumes are owned by root).
const dataDir = config.mode === "saas" ? config.dataDir : path.dirname(config.dbPath);
try {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.accessSync(dataDir, fs.constants.W_OK);
} catch {
  console.error(
    `✗ Can't write to ${dataDir}. Make sure a volume is mounted there. The container entrypoint and ` +
      "scripts/railway-start.sh make it writable when the container starts as root; otherwise make it writable by the 'node' user.",
  );
  process.exit(1);
}

const targets: { file: string; migrations: typeof MIGRATIONS }[] = [];
if (config.mode === "saas") {
  targets.push({ file: path.join(config.dataDir, "accounts.sqlite"), migrations: ACCOUNT_MIGRATIONS });
  const towns = path.join(config.dataDir, "towns");
  if (fs.existsSync(towns)) for (const f of fs.readdirSync(towns)) if (f.endsWith(".sqlite")) targets.push({ file: path.join(towns, f), migrations: MIGRATIONS });
} else {
  targets.push({ file: config.dbPath, migrations: MIGRATIONS });
}

let failed = 0;
for (const t of targets) {
  try {
    const db = openDatabase(t.file, t.migrations);
    const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
    db.close();
    console.log(`✓ ${path.relative(process.cwd(), t.file)} at schema v${user_version}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${t.file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`\n${targets.length - failed}/${targets.length} database(s) migrated`);
process.exit(failed ? 1 : 0);
