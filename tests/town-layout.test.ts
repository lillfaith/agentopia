import { describe, expect, it } from "vitest";
import { route } from "../web/src/world/navigation";
import type { SlotLayout } from "../web/src/theme-engine/types";
import { composeTown, distToPaths, inField } from "../web/src/themes/pastel-village/composition";
import { FALLBACK_SPOTS, PLOT, SLOTS, buildNav, fallbackSlot, inPlot, islandRadiusAt, townPaths } from "../web/src/themes/pastel-village/layout";

const SEEDED = { north: SLOTS.north, west: SLOTS.west, east: SLOTS.east };
const ALL = { ...SLOTS };
const WITH_CUSTOM: Record<string, SlotLayout> = { ...SLOTS };
for (let i = 0; i < FALLBACK_SPOTS.length; i++) WITH_CUSTOM[`custom-${i}`] = fallbackSlot(i);

const LAYOUTS: [string, Record<string, SlotLayout>][] = [
  ["seeded town", SEEDED],
  ["every plot occupied", ALL],
  ["every plot plus custom departments", WITH_CUSTOM],
];

function corners(l: SlotLayout): [number, number][] {
  const c = Math.cos(l.rotation);
  const s = Math.sin(l.rotation);
  return [
    [-PLOT.halfW, PLOT.zMin],
    [PLOT.halfW, PLOT.zMin],
    [-PLOT.halfW, PLOT.zMax],
    [PLOT.halfW, PLOT.zMax],
  ].map(([lx, lz]) => [l.position[0] + lx * c + lz * s, l.position[2] - lx * s + lz * c]);
}

describe("pastel village layout", () => {
  it("offers spare plots that never overlap designed ones", () => {
    expect(FALLBACK_SPOTS.length).toBeGreaterThan(0);
    for (const [x, z] of FALLBACK_SPOTS) for (const l of Object.values(SLOTS)) expect(Math.hypot(x - l.position[0], z - l.position[2])).toBeGreaterThan(8);
  });

  it("keeps every plot on the island", () => {
    for (const l of Object.values(WITH_CUSTOM)) for (const [x, z] of corners(l)) expect(Math.hypot(x, z)).toBeLessThan(islandRadiusAt(Math.atan2(z, x)) - 0.5);
  });

  for (const [name, slots] of LAYOUTS) {
    describe(name, () => {
      it("routes no path through a building plot", () => {
        const plots = Object.entries(slots);
        for (const path of townPaths(slots)) {
          const own = path.id.startsWith("door:") ? slots[path.id.slice(5)] : undefined;
          // the last point is the door itself, just outside its own plot
          for (const [x, z] of path.points.slice(1, -1)) {
            for (const [id, l] of plots) {
              if (l === own) continue;
              expect(inPlot(l, x, z, 0.3), `${path.id} crosses ${id}`).toBe(false);
            }
          }
        }
      });

      it("connects every door and hangout to the plaza", () => {
        const nav = buildNav(slots);
        const targets: [number, number][] = [...Object.values(slots).map((s) => s.door), ...(nav.hangouts ?? [])];
        for (const t of targets) {
          const r = route(nav, [7, 0], t);
          expect(r.length).toBeGreaterThan(0);
          // a real route ends at the target and never jumps more than one path segment
          for (let i = 1; i < r.length; i++) expect(Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1])).toBeLessThan(4.5);
        }
      });

      it("keeps scenery off paths and plots", () => {
        const c = composeTown(slots);
        const solids = [...c.trees, ...c.bushes, ...c.lamps, ...c.mushrooms];
        expect(c.trees.length).toBeGreaterThan(40);
        for (const s of solids) {
          expect(distToPaths(c.paths, s.x, s.z), `object at ${s.x.toFixed(1)},${s.z.toFixed(1)} on a path`).toBeGreaterThan(0.8);
          for (const l of Object.values(slots)) expect(inPlot(l, s.x, s.z)).toBe(false);
        }
        for (const h of c.hyacinths) {
          expect(inField(h.x, h.z, 0.2)).toBe(true);
          for (const l of Object.values(slots)) expect(inPlot(l, h.x, h.z)).toBe(false);
        }
      });
    });
  }

  it("is deterministic and stays within a scenery budget", () => {
    const a = composeTown(ALL);
    const b = composeTown(ALL);
    expect(a.trees).toEqual(b.trees);
    const instances = a.trees.length + a.bushes.length + a.flowers.length + a.hyacinths.length + a.hedges.length + a.lamps.length;
    expect(instances).toBeLessThan(4000);
  });

  it("has the plaza, pier and picnic features", () => {
    const c = composeTown(SEEDED);
    expect(c.openings.length).toBe(7); // 3 buildings + pier, picnic, garden and pond
    expect(c.pond).not.toBeNull();
    expect(c.garden).not.toBeNull();
    expect(c.hedges.length).toBeGreaterThan(30);
    expect(c.picnic).not.toBeNull();
    expect(c.hyacinths.length).toBeGreaterThan(150);
  });
});
