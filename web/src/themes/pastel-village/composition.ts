/**
 * Where every piece of scenery goes. Pure (no three.js) so it is unit-testable.
 *
 * Composition rules (a calm, toy-like board, read in this order):
 *  1. the plaza: the brightest, most detailed and most pink thing in view;
 *  2. buildings on clean lawn plots, one signature prop each;
 *  3. villagers on clear paths;
 *  4. scenery last: only two tree shapes (soft sage rounds and sakura), grouped
 *     into a few deliberate groves that frame the back of the island, with open
 *     lawn and a beach at the front. No scattered wildflowers or tiny props.
 * Everything yields to building plots and paths, so custom departments never end
 * up with a tree on their doorstep or scenery across their path.
 */
import type { SlotLayout } from "../../theme-engine/types";
import { TOKENS } from "./palette";
import { FEATURES, RING_RADIUS, beachWidthAt, inPlot, islandRadiusAt, pierStart, seeded, townPaths, type TownPath } from "./layout";

export interface Placement {
  x: number;
  z: number;
  /** Uniform scale (or length, for hedges). */
  s: number;
  /** Y rotation. */
  rot: number;
  color: string;
}
export type TreeKind = "round" | "blossom";
export interface TreePlacement extends Placement {
  kind: TreeKind;
}

export interface Composition {
  paths: TownPath[];
  trees: TreePlacement[];
  bushes: Placement[];
  flowers: Placement[];
  hyacinths: Placement[];
  hedges: Placement[];
  lamps: Placement[];
  benches: Placement[];
  /** Angles where paths leave the plaza (through the hedge ring). */
  openings: number[];
  picnic: { x: number; z: number; rot: number } | null;
  /** Pink petal carpets under blossom trees and in meadow drifts. */
  petalCarpets: Placement[];
  /** Flower planters ringing the town square. */
  planters: Placement[];
}

export const PLAZA_RADIUS = 5.6;
export const HEDGE_RADIUS = 9.7;
export const BED_RADIUS = 8.75;
const PATH_HALF_WIDTH = 0.75;

export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

export function distToPaths(paths: TownPath[], x: number, z: number): number {
  let best = Infinity;
  for (const p of paths) {
    const pts = p.points;
    for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment(x, z, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  }
  return best;
}

export function inField(x: number, z: number, pad = 0): boolean {
  const f = FEATURES.field;
  const dx = x - f.center[0];
  const dz = z - f.center[1];
  const c = Math.cos(f.rot);
  const s = Math.sin(f.rot);
  const u = dx * c + dz * s;
  const v = -dx * s + dz * c;
  return (u * u) / ((f.rx + pad) * (f.rx + pad)) + (v * v) / ((f.rz + pad) * (f.rz + pad)) < 1;
}

function nearPier(x: number, z: number, pad = 0): boolean {
  const ps = pierStart();
  const ex = ps.x + ps.dx * FEATURES.pier.length;
  const ez = ps.z + ps.dz * FEATURES.pier.length;
  return distToSegment(x, z, ps.x - ps.dx * 2.2, ps.z - ps.dz * 2.2, ex, ez) < 1.8 + pad;
}

const ROUNDS = TOKENS.foliage.greens;
const BLOSSOMS = TOKENS.foliage.blossoms;
const BED = TOKENS.flowers.bed;

export function composeTown(slots: Record<string, SlotLayout>): Composition {
  const rand = seeded(11);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
  const plots = Object.values(slots);
  const paths = townPaths(slots);
  const taken: { x: number; z: number; r: number }[] = [];
  const c: Composition = { paths, trees: [], bushes: [], flowers: [], hyacinths: [], hedges: [], lamps: [], benches: [], openings: [], picnic: null, petalCarpets: [], planters: [] };

  const pc = FEATURES.picnic.center;
  if (!plots.some((p) => inPlot(p, pc[0], pc[1], 1.6))) c.picnic = { x: pc[0], z: pc[1], rot: FEATURES.picnic.rot };

  /** Can a solid object of radius `r` stand at (x, z)? */
  const free = (x: number, z: number, r: number) => {
    const rr = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    if (rr + r > islandRadiusAt(a) - beachWidthAt(a) - 0.9) return false;
    if (rr - r < HEDGE_RADIUS + 1.2) return false;
    for (const p of plots) if (inPlot(p, x, z, r + 0.6)) return false;
    if (distToPaths(paths, x, z) < PATH_HALF_WIDTH + 0.6 + r) return false;
    if (inField(x, z, r + 0.4)) return false;
    if (c.picnic && Math.hypot(x - c.picnic.x, z - c.picnic.z) < 3 + r) return false;
    if (nearPier(x, z, r)) return false;
    for (const t of taken) if (Math.hypot(x - t.x, z - t.z) < t.r + r) return false;
    return true;
  };
  const take = (x: number, z: number, r: number) => taken.push({ x, z, r });

  // ── 1. plaza: openings, hedge ring, one-colour flower bed, paired lanterns ──
  for (const p of paths) {
    const pts = p.points;
    for (let i = 1; i < pts.length; i++) {
      const r0 = Math.hypot(...pts[i - 1]);
      const r1 = Math.hypot(...pts[i]);
      if (r0 <= HEDGE_RADIUS && r1 > HEDGE_RADIUS) {
        const t = (HEDGE_RADIUS - r0) / (r1 - r0 || 1);
        c.openings.push(Math.atan2(pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t, pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t));
        break;
      }
    }
  }
  const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const nearOpening = (a: number, w: number) => c.openings.some((o) => angDist(a, o) < w);
  const hedgeStep = 1.05 / HEDGE_RADIUS;
  for (let a = 0; a < Math.PI * 2 - hedgeStep / 2; a += hedgeStep) {
    if (nearOpening(a, 0.16)) continue;
    c.hedges.push({ x: Math.cos(a) * HEDGE_RADIUS, z: Math.sin(a) * HEDGE_RADIUS, s: 1.12, rot: -a + Math.PI / 2, color: TOKENS.foliage.hedge });
  }
  for (const o of c.openings) {
    for (const side of [-1, 1]) {
      const a = o + side * 0.2;
      const x = Math.cos(a) * (HEDGE_RADIUS + 0.1);
      const z = Math.sin(a) * (HEDGE_RADIUS + 0.1);
      if (distToPaths(paths, x, z) < 1.0 || c.lamps.some((l) => Math.hypot(l.x - x, l.z - z) < 1.2)) continue;
      c.lamps.push({ x, z, s: 1, rot: -a, color: TOKENS.glow.lampGlass });
      take(x, z, 0.4);
    }
  }
  // A single planted band of blush, rose and white: calm, but unmistakably pink.
  for (let a = 0; a < Math.PI * 2; a += 0.085) {
    if (nearOpening(a, 0.13)) continue;
    for (const dr of [-0.25, 0.25]) {
      const aa = a + (rand() - 0.5) * 0.04;
      const r = BED_RADIUS + dr + (rand() - 0.5) * 0.08;
      c.flowers.push({ x: Math.cos(aa) * r, z: Math.sin(aa) * r, s: 1.0 + rand() * 0.3, rot: rand() * 6.28, color: pick(BED) });
    }
  }
  for (const a of [0.8, 2.4, 3.9, 5.5]) c.benches.push({ x: Math.cos(a) * 4.6, z: Math.sin(a) * 4.6, s: 1, rot: -a - Math.PI / 2, color: TOKENS.wood.bench });
  for (const a of [0, 1.6, 3.15, 4.7]) c.planters.push({ x: Math.cos(a) * 5.05, z: Math.sin(a) * 5.05, s: 1, rot: -a, color: BED[0] });

  // Four sakura on the diagonals frame the square.
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    for (const r of [11.6, 12.6]) {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (free(x, z, 1.1)) {
        c.trees.push({ kind: "blossom", x, z, s: 1.15, rot: a, color: BLOSSOMS[0] });
        take(x, z, 1.6);
        break;
      }
    }
  }

  // ── 4. scenery: a few deliberate groves, mostly behind the town ──
  // Each grove is one shape and one colour family, with a bush or two at its foot.
  let g = 0;
  for (let a = 0.1; a < Math.PI * 2; a += 0.36) {
    const back = Math.sin(a) < 0.35; // the far side from the default camera
    if (!back && rand() < 0.45) continue;
    const R = islandRadiusAt(a) - beachWidthAt(a);
    const cr = R - 2.6;
    const cx = Math.cos(a) * cr;
    const cz = Math.sin(a) * cr;
    const kind: TreeKind = g++ % 3 === 1 ? "blossom" : "round";
    const color = kind === "blossom" ? pick(BLOSSOMS) : pick(ROUNDS);
    const members: [number, number, number][] = back
      ? [
          [0, 0, 1.15],
          [1.9, 0.3, 0.95],
          [-1.9, 0.4, 1.0],
          [0.9, 1.9, 0.9],
          [-0.9, 1.9, 0.85],
        ]
      : [
          [0, 0, 1.05],
          [1.6, 0.5, 0.85],
          [-1.5, 0.4, 0.8],
        ];
    const ca = Math.cos(a + Math.PI / 2);
    const sa = Math.sin(a + Math.PI / 2);
    for (const [u, v, s] of members) {
      // u runs along the shore, v inwards
      const x = cx + ca * u - Math.cos(a) * v;
      const z = cz + sa * u - Math.sin(a) * v;
      // Grove members may touch: canopies overlapping read as one soft mass.
      if (!free(x, z, 0.8 * s)) continue;
      c.trees.push({ kind, x, z, s, rot: rand() * 6.28, color });
      take(x, z, 0.9 * s);
    }
    const bx = cx - Math.cos(a) * 2.3;
    const bz = cz - Math.sin(a) * 2.3;
    if (free(bx, bz, 0.6)) {
      c.bushes.push({ x: bx, z: bz, s: 0.85, rot: rand() * 6.28, color: kind === "blossom" ? TOKENS.foliage.flowering[0] : pick(TOKENS.foliage.bushes) });
      take(bx, bz, 0.8);
    }
  }
  // One sakura in each wide gap between buildings, so plots read as separate.
  const angles = plots.map((p) => ({ a: Math.atan2(p.position[2], p.position[0]), r: Math.hypot(p.position[0], p.position[2]) })).sort((x, y) => x.a - y.a);
  for (let i = 0; i < angles.length && angles.length > 1; i++) {
    const p = angles[i];
    const q = angles[(i + 1) % angles.length];
    let gap = q.a - p.a;
    if (gap <= 0) gap += Math.PI * 2;
    if (gap < 0.6) continue;
    const mid = p.a + gap / 2;
    const r = Math.max(13.5, Math.min(18, (p.r + q.r) / 2));
    const x = Math.cos(mid) * r;
    const z = Math.sin(mid) * r;
    if (!free(x, z, 1.1)) continue;
    c.trees.push({ kind: "blossom", x, z, s: 1.0, rot: rand() * 6.28, color: pick(BLOSSOMS) });
    take(x, z, 1.4);
  }

  // ── landmarks: hyacinth field in planted rows ──
  {
    const f = FEATURES.field;
    const rows = TOKENS.flowers.hyacinths;
    const cs = Math.cos(f.rot);
    const sn = Math.sin(f.rot);
    let row = 0;
    for (let v = -f.rz + 0.25; v < f.rz; v += 0.52, row++) {
      const hw = f.rx * Math.sqrt(Math.max(0, 1 - (v / f.rz) ** 2));
      for (let u = -hw + 0.15; u < hw; u += 0.38) {
        const x = f.center[0] + u * cs - v * sn;
        const z = f.center[1] + u * sn + v * cs;
        if (plots.some((p) => inPlot(p, x, z, 0.3)) || distToPaths(paths, x, z) < PATH_HALF_WIDTH + 0.2) continue;
        c.hyacinths.push({ x, z, s: 0.9 + rand() * 0.2, rot: rand() * 6.28, color: rows[row % rows.length] });
      }
    }
  }

  // Soft petal carpets under the sakura only.
  for (const t of c.trees) if (t.kind === "blossom") c.petalCarpets.push({ x: t.x, z: t.z, s: 3.2 * t.s, rot: t.rot, color: TOKENS.ground.patchBlush });

  return c;
}

/** Ring-path radius re-exported for the renderer. */
export { RING_RADIUS };
