import { describe, expect, it } from "vitest";
import { loadConfig } from "../server/config.js";

describe("deployment defaults", () => {
  it("defaults to SaaS on Railway, so a public bind needs no admin token", () => {
    const c = loadConfig({ HOST: "0.0.0.0", NODE_ENV: "production", RAILWAY_PROJECT_ID: "p1", RAILWAY_PUBLIC_DOMAIN: "agentopia-production.up.railway.app" } as NodeJS.ProcessEnv);
    expect(c).toMatchObject({ mode: "saas", dataDir: "/data", trustProxy: true, publicOrigin: "https://agentopia-production.up.railway.app" });
  });

  it("lets explicit variables override the Railway defaults", () => {
    const c = loadConfig({ HOST: "0.0.0.0", RAILWAY_PROJECT_ID: "p1", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app", AGENTOPIA_PUBLIC_ORIGIN: "https://app.example.com/", AGENTOPIA_TRUST_PROXY: "false" } as NodeJS.ProcessEnv);
    expect(c).toMatchObject({ mode: "saas", trustProxy: false, publicOrigin: "https://app.example.com" });
  });

  it("stays a single protected town elsewhere", () => {
    expect(loadConfig({ HOST: "127.0.0.1" } as NodeJS.ProcessEnv).mode).toBe("local");
    expect(() => loadConfig({ HOST: "0.0.0.0" } as NodeJS.ProcessEnv)).toThrow(/AGENTOPIA_ADMIN_TOKEN/);
  });
});
