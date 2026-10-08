/**
 * Where every piece of scenery goes. Pure (no three.js) so it is unit-testable.
 *
 * The village is composed in zones rather than scattered at random:
 *  - a flagstone plaza ringed by a cobble path, a flower bed and a clipped hedge,
 *    with paired lanterns marking every path opening;
 *  - a forest belt that frames the back of the island, thinning towards the front;
 *  - small groves between neighbouring buildings, blossom trees on the diagonals;
 *  - a beach with a lit pier at the front, a hyacinth field and a picnic corner.
 * Everything yields to building plots and paths, so custom departments never end
 * up with a tree on their doorstep or scenery across their path.
 */
import type { SlotLayout } from "../../theme-engine/types";
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
export type TreeKind = "round" | "pine" | "blossom" | "poplar";
export interface TreePlacement extends Placement {
  kind: TreeKind;
}

export interface Composition {
  paths: TownPath[];
  trees: TreePlacement[];
  bushes: Placement[];
  mushrooms: Placement[];
  rocks: Placement[];
  flowers: Placement[];
  hyacinths: Placement[];
  hedges: Placement[];
  lamps: Placement[];
  benches: Placement[];
  /** Angles where paths leave the plaza (through the hedge ring). */
  openings: number[];
  picnic: { x: number; z: number; rot: number } | null;
  pond: { x: number; z: number; rx: number; rz: number; rot: number } | null;
  garden: { x: number; z: number; w: number; d: number; rot: number } | null;
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

const GREENS = ["#8fd18a", "#a6dc8c", "#7fc79a", "#b5e08e", "#93d4b0"];
const BLOSSOMS = ["#ffb7cf", "#ffc9dc", "#f7a8c8", "#ffd3e2"];
const PEACH = ["#ffc79e", "#ffd6a5", "#f9bf9a"];
const PINES = ["#6fbf9a", "#7ccaa3", "#62b392"];
const FLOWER_SETS = [
  ["#ff9fc4", "#fff1a8", "#ffffff"],
  ["#c9b4ff", "#ffd1e3", "#9fd8ff"],
  ["#ffb38a", "#ffe08a", "#ff9fc4"],
  ["#a8e6ff", "#d8c8ff", "#ffffff"],
];

export function composeTown(slots: Record<string, SlotLayout>): Composition {
  const rand = seeded(11);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
  const plots = Object.values(slots);
  const paths = townPaths(slots);
  const taken: { x: number; z: number; r: number }[] = [];
  const c: Composition = { paths, trees: [], bushes: [], mushrooms: [], rocks: [], flowers: [], hyacinths: [], hedges: [], lamps: [], benches: [], openings: [], picnic: null, pond: null, garden: null };

  const pc = FEATURES.picnic.center;
  const picnicFree = !plots.some((p) => inPlot(p, pc[0], pc[1], 1.6));
  if (picnicFree) c.picnic = { x: pc[0], z: pc[1], rot: FEATURES.picnic.rot };
  const pd = FEATURES.pond;
  if (!plots.some((p) => inPlot(p, pd.center[0], pd.center[1], pd.rx + 0.6)))
    c.pond = { x: pd.center[0], z: pd.center[1], rx: pd.rx, rz: pd.rz, rot: pd.rot };
  const gd = FEATURES.garden;
  const gr = Math.hypot(gd.w, gd.d) / 2;
  if (!plots.some((p) => inPlot(p, gd.center[0], gd.center[1], gr + 0.4)))
    c.garden = { x: gd.center[0], z: gd.center[1], w: gd.w, d: gd.d, rot: gd.rot };

  /** Can a solid object of radius `r` stand at (x, z)? */
  const free = (x: number, z: number, r: number, opts: { pathClear?: number; plaza?: boolean; beach?: boolean } = {}) => {
    const rr = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const edge = islandRadiusAt(a) - (opts.beach ? 0.6 : beachWidthAt(a) + 0.9);
    if (rr + r > edge) return false;
    if (!opts.plaza && rr - r < HEDGE_RADIUS + 0.7) return false;
    for (const p of plots) if (inPlot(p, x, z, r + 0.3)) return false;
    if (distToPaths(paths, x, z) < (opts.pathClear ?? PATH_HALF_WIDTH + 0.35) + r) return false;
    if (inField(x, z, r + 0.2)) return false;
    if (c.picnic && Math.hypot(x - c.picnic.x, z - c.picnic.z) < 2.8 + r) return false;
    if (c.pond && Math.hypot((x - c.pond.x) / (c.pond.rx + 0.9 + r), (z - c.pond.z) / (c.pond.rz + 0.9 + r)) < 1) return false;
    if (c.garden && Math.hypot(x - c.garden.x, z - c.garden.z) < Math.hypot(c.garden.w, c.garden.d) / 2 + 0.6 + r) return false;
    if (nearPier(x, z, r)) return false;
    for (const t of taken) if (Math.hypot(x - t.x, z - t.z) < t.r + r) return false;
    return true;
  };
  const take = (x: number, z: number, r: number) => taken.push({ x, z, r });

  // ── plaza openings, hedge ring, flower bed, lanterns ──
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
    c.hedges.push({ x: Math.cos(a) * HEDGE_RADIUS, z: Math.sin(a) * HEDGE_RADIUS, s: 1.12, rot: -a + Math.PI / 2, color: "#8dcf96" });
  }
  for (const o of c.openings) {
    for (const side of [-1, 1]) {
      const a = o + side * 0.2;
      const x = Math.cos(a) * (HEDGE_RADIUS + 0.1);
      const z = Math.sin(a) * (HEDGE_RADIUS + 0.1);
      if (distToPaths(paths, x, z) < 1.0 || c.lamps.some((l) => Math.hypot(l.x - x, l.z - z) < 1.2)) continue;
      c.lamps.push({ x, z, s: 1, rot: -a, color: "#fff1c7" });
      take(x, z, 0.4);
    }
  }
  // Flower bed: colour sets change between openings for a planted, intentional look.
  const sorted = [...c.openings].sort((x, y) => x - y);
  for (let a = 0; a < Math.PI * 2; a += 0.075) {
    if (nearOpening(a, 0.13)) continue;
    let seg = sorted.findIndex((o) => o > a);
    if (seg < 0) seg = 0;
    const set = FLOWER_SETS[seg % FLOWER_SETS.length];
    for (const dr of [-0.32, 0, 0.32]) {
      const aa = a + (rand() - 0.5) * 0.05;
      const r = BED_RADIUS + dr + (rand() - 0.5) * 0.12;
      c.flowers.push({ x: Math.cos(aa) * r, z: Math.sin(aa) * r, s: 0.9 + rand() * 0.5, rot: rand() * 6.28, color: set[Math.floor(rand() * set.length)] });
    }
  }
  // Benches on the flagstones, facing the medallion.
  for (const a of [0.8, 2.4, 3.9, 5.5]) c.benches.push({ x: Math.cos(a) * 4.6, z: Math.sin(a) * 4.6, s: 1, rot: -a - Math.PI / 2, color: "#d79a74" });

  // ── blossom trees on the plaza diagonals ──
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    for (const r of [11.3, 12.2]) {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (free(x, z, 1.1)) {
        c.trees.push({ kind: "blossom", x, z, s: 1.15, rot: a, color: BLOSSOMS[0] });
        take(x, z, 1.4);
        break;
      }
    }
  }

  // ── groves between neighbouring buildings ──
  const angles = plots.map((p) => ({ a: Math.atan2(p.position[2], p.position[0]), r: Math.hypot(p.position[0], p.position[2]) })).sort((x, y) => x.a - y.a);
  for (let i = 0; i < angles.length; i++) {
    const p = angles[i];
    const q = angles[(i + 1) % angles.length];
    let gap = q.a - p.a;
    if (gap <= 0) gap += Math.PI * 2;
    if (gap < 0.55 || angles.length < 2) continue;
    const mid = p.a + gap / 2;
    const r = Math.max(13.5, Math.min(19, (p.r + q.r) / 2));
    const kind: TreeKind = rand() < 0.5 ? "round" : "poplar";
    const color = kind === "round" ? pick(GREENS) : pick(PINES);
    const pieces: [number, number, "tree" | "small" | "bush"][] = [
      [0, 0, "tree"],
      [1.5, 0.7, "small"],
      [-1.2, 1.1, "bush"],
      [0.6, -1.4, "bush"],
      [-1.4, -0.9, "small"],
    ];
    const cx = Math.cos(mid) * r;
    const cz = Math.sin(mid) * r;
    for (const [ox, oz, what] of pieces) {
      const x = cx + ox;
      const z = cz + oz;
      const rad = what === "bush" ? 0.6 : what === "small" ? 0.8 : 1.1;
      if (!free(x, z, rad)) continue;
      if (what === "bush") c.bushes.push({ x, z, s: 0.8 + rand() * 0.3, rot: rand() * 6.28, color: pick(GREENS) });
      else c.trees.push({ kind, x, z, s: what === "small" ? 0.75 : 1.1, rot: rand() * 6.28, color });
      take(x, z, rad + 0.2);
    }
  }

  // ── forest belt framing the back of the island ──
  for (let a = 0; a < Math.PI * 2; a += 0.055) {
    const back = Math.sin(a) < 0.25; // z < 0 is the far side from the default camera
    const rows = back ? 3 : 1;
    // Colour regions drift around the rim so trees read as planted groups.
    const region = Math.floor((a + Math.sin(a * 3) * 0.3) / 0.7) % 5;
    for (let row = 0; row < rows; row++) {
      if (!back && rand() < 0.55) continue;
      const R = islandRadiusAt(a) - beachWidthAt(a);
      const r = R - 1.7 - row * 1.8 - rand() * 0.6;
      const aa = a + (rand() - 0.5) * 0.04;
      const x = Math.cos(aa) * r;
      const z = Math.sin(aa) * r;
      const kind: TreeKind = region === 0 ? "pine" : region === 1 ? "round" : region === 2 ? (back ? "pine" : "blossom") : region === 3 ? "poplar" : "round";
      const rad = kind === "poplar" ? 0.7 : kind === "pine" ? 0.85 : 1.0;
      const s = (row === 0 ? 0.95 : 1.1) * (0.85 + rand() * 0.35);
      if (!free(x, z, rad * s)) continue;
      const color = kind === "pine" ? pick(PINES) : kind === "blossom" ? pick(BLOSSOMS) : kind === "poplar" ? pick(GREENS) : region === 4 ? pick(PEACH) : pick(GREENS);
      c.trees.push({ kind, x, z, s, rot: rand() * 6.28, color });
      take(x, z, rad * s + 0.25);
    }
  }

  // ── beach-side blossom trees (by the pier and the picnic) ──
  for (const a of [0.05, 0.42, 1.1, 1.45, 1.85, 2.2]) {
    const R = islandRadiusAt(a) - beachWidthAt(a);
    const x = Math.cos(a) * (R - 1.4);
    const z = Math.sin(a) * (R - 1.4);
    if (free(x, z, 1.0)) {
      c.trees.push({ kind: "blossom", x, z, s: 1.0 + rand() * 0.25, rot: rand() * 6.28, color: pick(BLOSSOMS) });
      take(x, z, 1.3);
    }
  }

  // ── mushrooms: little clusters tucked into the forest ──
  for (let i = 0, made = 0; i < 400 && made < 7; i++) {
    const a = Math.PI + rand() * Math.PI;
    const r = islandRadiusAt(a) - 3 - rand() * 4;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!free(x, z, 0.9)) continue;
    const cap = pick(["#ff8fa3", "#ff9e7a", "#c79bff", "#7fb8ff"]);
    for (let k = 0; k < 3; k++) {
      const mx = x + (rand() - 0.5) * 1.1;
      const mz = z + (rand() - 0.5) * 1.1;
      c.mushrooms.push({ x: mx, z: mz, s: 0.35 + rand() * 0.35, rot: rand() * 6.28, color: cap });
    }
    take(x, z, 1.1);
    made++;
  }

  // ── bushes and rocks ──
  for (let i = 0; i < 900 && c.bushes.length < 40; i++) {
    const a = rand() * Math.PI * 2;
    // Bushes gather at the edges of the forest belt and along the hedge, not mid-meadow.
    const edge = islandRadiusAt(a) - beachWidthAt(a);
    const r = rand() < 0.6 ? edge - 4.5 - rand() * 3.5 : HEDGE_RADIUS + 1.6 + rand() * 1.2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!free(x, z, 0.6)) continue;
    c.bushes.push({ x, z, s: 0.65 + rand() * 0.45, rot: rand() * 6.28, color: pick(GREENS) });
    take(x, z, 0.8);
  }
  for (let a = 0; a < Math.PI * 2; a += 0.21) {
    if (rand() < 0.45) continue;
    const onBeach = beachWidthAt(a) > 0.5;
    const R = islandRadiusAt(a);
    const r = onBeach ? R + 0.4 + rand() * 0.6 : R - 0.8;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (nearPier(x, z, 0.5)) continue;
    c.rocks.push({ x, z, s: 0.3 + rand() * 0.45, rot: rand() * 6.28, color: rand() < 0.5 ? "#ddd5e8" : "#e8ddd0" });
  }

  // ── lanterns along the paths, flowers lining them ──
  for (const p of paths) {
    let acc = 0;
    let side = 1;
    let flowerAcc = 0;
    for (let i = 1; i < p.points.length; i++) {
      const [ax, az] = p.points[i - 1];
      const [bx, bz] = p.points[i];
      const seg = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / (seg || 1);
      const nz = (bx - ax) / (seg || 1);
      acc += seg;
      flowerAcc += seg;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      if (Math.hypot(mx, mz) < HEDGE_RADIUS + 1.5) continue;
      if (acc > 5.5) {
        const x = mx + nx * side * 1.15;
        const z = mz + nz * side * 1.15;
        if (free(x, z, 0.2, { pathClear: 1.0 })) {
          c.lamps.push({ x, z, s: 1, rot: Math.atan2(nx * side, nz * side), color: "#fff1c7" });
          take(x, z, 0.5);
          acc = 0;
          side = -side;
        }
      }
      if (flowerAcc > 1.2) {
        flowerAcc = 0;
        const set = pick(FLOWER_SETS);
        for (const sd of [-1, 1]) {
          if (rand() < 0.35) continue;
          for (let k = 0; k < 3; k++) {
            const off = 1.05 + rand() * 0.35;
            const x = mx + nx * sd * off + (rand() - 0.5) * 0.4;
            const z = mz + nz * sd * off + (rand() - 0.5) * 0.4;
            if (free(x, z, 0.05, { pathClear: 0.95 })) c.flowers.push({ x, z, s: 0.8 + rand() * 0.4, rot: rand() * 6.28, color: set[k % set.length] });
          }
        }
      }
    }
  }
  // Wildflowers in the meadows, in loose drifts.
  for (let i = 0, drifts = 0; i < 1200 && drifts < 34; i++) {
    const a = rand() * Math.PI * 2;
    const r = HEDGE_RADIUS + 1.5 + rand() * (islandRadiusAt(a) - HEDGE_RADIUS - 3);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!free(x, z, 0.5)) continue;
    const color = pick(pick(FLOWER_SETS));
    for (let k = 0; k < 7; k++) {
      const fx = x + (rand() - 0.5) * 1.6;
      const fz = z + (rand() - 0.5) * 1.6;
      if (free(fx, fz, 0.05)) c.flowers.push({ x: fx, z: fz, s: 0.7 + rand() * 0.4, rot: rand() * 6.28, color });
    }
    drifts++;
  }

  // ── hyacinth field in planted rows ──
  {
    const f = FEATURES.field;
    const rows = ["#f4a6c8", "#e98bb8", "#d8b4f0", "#fbe3ef", "#b9a5ee", "#ffc2d8", "#f7b2d0"];
    const cs = Math.cos(f.rot);
    const sn = Math.sin(f.rot);
    let row = 0;
    for (let v = -f.rz + 0.25; v < f.rz; v += 0.48, row++) {
      const hw = f.rx * Math.sqrt(Math.max(0, 1 - (v / f.rz) ** 2));
      for (let u = -hw + 0.15; u < hw; u += 0.34) {
        const uu = u + (rand() - 0.5) * 0.12;
        const vv = v + (rand() - 0.5) * 0.12;
        const x = f.center[0] + uu * cs - vv * sn;
        const z = f.center[1] + uu * sn + vv * cs;
        if (plots.some((p) => inPlot(p, x, z, 0.3)) || distToPaths(paths, x, z) < PATH_HALF_WIDTH + 0.2) continue;
        c.hyacinths.push({ x, z, s: 0.8 + rand() * 0.45, rot: rand() * 6.28, color: rows[row % rows.length] });
      }
    }
  }

  return c;
}

/** Ring-path radius re-exported for the renderer. */
export { RING_RADIUS };
