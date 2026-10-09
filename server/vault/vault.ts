import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Encrypts API keys and tokens that owners add for their villagers (AES-256-GCM).
 *
 * The master key comes from AGENTOPIA_SECRETS_KEY (32 bytes, base64 or hex). Without it, a key
 * is generated once and kept in <data dir>/secrets.key (mode 0600). That file is NOT included in
 * backups, so a restored backup needs the same key: set AGENTOPIA_SECRETS_KEY in production.
 *
 * Plaintext secrets only exist in memory, for the duration of a call to the provider.
 */
export class Vault {
  private constructor(private readonly key: Buffer) {}

  static fromKey(key: Buffer): Vault {
    if (key.length !== 32) throw new Error("The secrets key must be 32 bytes");
    return new Vault(key);
  }

  /** Resolve the master key: explicit value, then key file, then (when allowed) a new key file. */
  static open(opts: { secretsKey: string | null; keyFile: string | null }): Vault {
    if (opts.secretsKey) return Vault.fromKey(decodeKey(opts.secretsKey));
    if (!opts.keyFile) return Vault.fromKey(randomBytes(32)); // in-memory databases (tests, one-off scripts)
    if (fs.existsSync(opts.keyFile)) return Vault.fromKey(decodeKey(fs.readFileSync(opts.keyFile, "utf8").trim()));
    fs.mkdirSync(path.dirname(opts.keyFile), { recursive: true });
    const key = randomBytes(32);
    try {
      fs.writeFileSync(opts.keyFile, key.toString("base64"), { mode: 0o600, flag: "wx" });
    } catch (err) {
      // Another process created it first: use theirs.
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return Vault.fromKey(decodeKey(fs.readFileSync(opts.keyFile, "utf8").trim()));
      throw err;
    }
    return Vault.fromKey(key);
  }

  /** `aad` binds the ciphertext to one record, so it can't be copied onto another. */
  encrypt(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
  }

  decrypt(sealed: string, aad: string): string {
    if (!sealed.startsWith("v1:")) throw new Error("Unknown secret format");
    const raw = Buffer.from(sealed.slice(3), "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
}

function decodeKey(value: string): Buffer {
  const v = value.trim();
  const key = /^[0-9a-f]{64}$/i.test(v) ? Buffer.from(v, "hex") : Buffer.from(v, "base64");
  if (key.length !== 32) throw new Error("AGENTOPIA_SECRETS_KEY must be 32 bytes, as 64 hex characters or base64");
  return key;
}
