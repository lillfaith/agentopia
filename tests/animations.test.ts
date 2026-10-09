import { describe, expect, it } from "vitest";
import type { AgentStatus } from "../shared/types";
import { WORK_ANIMS, animForStatus, type CharacterAnim } from "../web/src/theme-engine/types";

const STATUSES: AgentStatus[] = ["idle", "planning", "working", "waiting_approval", "delivering", "completed", "failed"];
const DECORATIVE: CharacterAnim[] = ["idle", "walk", "rest", "sleep", "converse"];

describe("character animation contract", () => {
  it("maps every real status to a work animation, and only idle to a decorative one", () => {
    for (const s of STATUSES) {
      const anim = animForStatus(s);
      if (s === "idle") expect(anim).toBe("idle");
      else expect(WORK_ANIMS.has(anim), `${s} → ${anim}`).toBe(true);
    }
  });

  it("celebrates only a completed status, and shows confusion only on failure", () => {
    for (const s of STATUSES) {
      expect(animForStatus(s) === "celebrate").toBe(s === "completed");
      expect(animForStatus(s) === "confused").toBe(s === "failed");
    }
  });

  it("keeps decorative animations out of the work set", () => {
    for (const a of DECORATIVE) expect(WORK_ANIMS.has(a)).toBe(false);
  });
});
