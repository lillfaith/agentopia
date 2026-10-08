import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Consistent online backups of the accounts database and every town file
 * (SQLite VACUUM INTO, safe while the server runs) into
 * <dataDir>/backups/<timestamp>/, keeping the newest `keep` snapshots.
 */
export function backupSaas(dataDir: string, keep = 7): { dir: string; files: number; bytes: number } {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const root = path.join(dataDir, "backups");
  const dir = path.join(root, stamp);
  fs.mkdirSync(path.join(dir, "towns"), { recursive: true });
  const sources = [path.join(dataDir, "accounts.sqlite")];
  const townsDir = path.join(dataDir, "towns");
  if (fs.existsSync(townsDir)) for (const f of fs.readdirSync(townsDir)) if (f.endsWith(".sqlite")) sources.push(path.join(townsDir, f));
  let bytes = 0;
  let files = 0;
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    const out = src.startsWith(townsDir) ? path.join(dir, "towns", path.basename(src)) : path.join(dir, path.basename(src));
    const db = new DatabaseSync(src);
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      db.prepare("VACUUM INTO ?").run(out);
    } finally {
      db.close();
    }
    const check = new DatabaseSync(out, { readOnly: true });
    const ok = (check.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    check.close();
    if (ok !== "ok") throw new Error(`Backup of ${path.basename(src)} failed its integrity check: ${ok}`);
    bytes += fs.statSync(out).size;
    files += 1;
  }
  const snapshots = fs.readdirSync(root).filter((d) => fs.statSync(path.join(root, d)).isDirectory()).sort();
  for (const old of snapshots.slice(0, Math.max(0, snapshots.length - keep))) fs.rmSync(path.join(root, old), { recursive: true, force: true });
  return { dir, files, bytes };
}
