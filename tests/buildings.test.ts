import { describe, expect, it } from "vitest";
import { buildingModel } from "../web/src/themes/pastel-village/Buildings";

const KINDS = ["hq", "research", "studio", "workshop", "atelier", "lab", "bakery", "something-new"];

describe("pastel village buildings", () => {
  it("builds every kind (and unknown kinds) as a few merged meshes", () => {
    for (const kind of KINDS) {
      const m = buildingModel(kind, `Test ${kind}`, `id-${kind}`);
      // one merged mesh per material keeps a detailed building to a handful of draw calls
      expect(m.parts.length, kind).toBeLessThanOrEqual(11);
      const vertices = m.parts.reduce((n, p) => n + p.geometry.attributes.position.count, 0);
      expect(vertices, kind).toBeGreaterThan(500);
      expect(vertices, kind).toBeLessThan(60000);
      for (const p of m.parts) {
        expect(p.geometry.attributes.color, `${kind}/${p.mat} vertex colours`).toBeDefined();
        expect(Number.isFinite(p.geometry.boundingSphere?.radius)).toBe(true);
      }
      expect(m.sign.pos.every(Number.isFinite)).toBe(true);
    }
  });

  it("gives unknown departments a distinct but deterministic cottage", () => {
    const a = buildingModel("bakery", "A", "alpha");
    const b = buildingModel("bakery", "A", "alpha");
    const c = buildingModel("bakery", "B", "beta");
    const colours = (m: typeof a) => Array.from(m.parts.find((p) => p.mat === "plaster")!.geometry.attributes.color.array.slice(0, 3));
    expect(colours(a)).toEqual(colours(b));
    expect(colours(a)).not.toEqual(colours(c));
  });
});
