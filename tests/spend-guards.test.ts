import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOWS = path.join(__dirname, "..", ".github", "workflows");

/** The `on:` block of a workflow file (everything from `on:` up to the next top-level key). */
function triggers(yaml: string): string {
  const m = yaml.match(/^on:\s*\n([\s\S]*?)(?=^\S)/m);
  return m ? m[1] : "";
}

describe("paid API spend guards", () => {
  it("never runs a workflow that holds an API key on a push, pull request or schedule", () => {
    const files = fs.readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    const paid = files.filter((f) => /ANTHROPIC_API_KEY|ANTHROPIC_KEY|CLAUDE_API_KEY/.test(fs.readFileSync(path.join(WORKFLOWS, f), "utf8")));
    expect(paid.length).toBeGreaterThan(0);
    for (const f of paid) {
      const on = triggers(fs.readFileSync(path.join(WORKFLOWS, f), "utf8"));
      expect(on, `${f} must be started by hand (workflow_dispatch only)`).toMatch(/workflow_dispatch/);
      expect(on, `${f} must not run automatically`).not.toMatch(/\b(push|pull_request|pull_request_target|schedule|workflow_run)\s*:/);
    }
  });

  it("keeps the unit-test workflow free of API keys", () => {
    const ci = fs.readFileSync(path.join(WORKFLOWS, "ci.yml"), "utf8");
    expect(ci).not.toMatch(/ANTHROPIC|CLAUDE_API_KEY|secrets\./);
  });
});
