import type { LightingPreset, NavGraph, SlotLayout } from "../../theme-engine/types";
import type { LightingKeyframe } from "../../environment/dayCycle";

export const RING_RADIUS = 7;
const RING_NODES = 24;
/** Building plot footprint (local coordinates, door facing +z). Used to keep paths and scenery clear. */
export const PLOT = { halfW: 3.3, zMin: -3.1, zMax: 3.6 };

/** Organic island outline: radius at angle `a` (x = cos a, z = sin a). */
export function islandRadiusAt(a: number): number {
  return 27 + 1.1 * Math.sin(3 * a + 0.7) + 0.7 * Math.sin(5 * a + 2.1) + 0.5 * Math.sin(7 * a + 0.3);
}

/** Sandy beach along the front (camera-facing) shore. Width in world units at angle `a` (0 = no beach). */
export const BEACH = { from: -0.25, to: 1.95, width: 2.8 };
export function beachWidthAt(a: number): number {
  let x = a;
  while (x < -Math.PI) x += Math.PI * 2;
  while (x > Math.PI) x -= Math.PI * 2;
  if (x < BEACH.from || x > BEACH.to) return 0;
  const edge = Math.min(x - BEACH.from, BEACH.to - x);
  const t = Math.min(1, edge / 0.45);
  return BEACH.width * t * t * (3 - 2 * t);
}

/** Fixed landmarks of this theme (not building plots). */
export const FEATURES = {
  pier: { angle: 0.12, length: 8.5 },
  pond: { center: [5.9, 19.6] as [number, number], rx: 2.1, rz: 1.45, rot: 0.3 },
  garden: { center: [-6.9, 19.9] as [number, number], w: 3.4, d: 2.6, rot: 2.8 },
  field: { center: [-18.6, 10.4] as [number, number], rx: 4.6, rz: 3.2, rot: 0.55 },
  picnic: { center: [-15.6, 16.6] as [number, number], rot: 0.75 },
};

/** Where the pier meets the sand, and its direction (outwards). */
export function pierStart(): { x: number; z: number; dx: number; dz: number } {
  const a = FEATURES.pier.angle;
  const r = islandRadiusAt(a) - 1.2;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r, dx: Math.cos(a), dz: Math.sin(a) };
}

/** Place a building at (x, z) facing the plaza centre. */
function facingCentre(x: number, z: number, doorOffset = 3.6): SlotLayout {
  const len = Math.hypot(x, z) || 1;
  const dx = -x / len;
  const dz = -z / len;
  const door: [number, number] = [x + dx * doorOffset, z + dz * doorOffset];
  // Perpendicular to the facing direction, for idle spots in front of the plot.
  const px = -dz;
  const pz = dx;
  return {
    position: [x, 0, z],
    rotation: Math.atan2(dx, dz),
    door,
    idleSpots: [
      [door[0] + dx * 0.9 + px * 2.2, door[1] + dz * 0.9 + pz * 2.2],
      [door[0] + dx * 0.9 - px * 2.2, door[1] + dz * 0.9 - pz * 2.2],
      [door[0] + dx * 1.7 + px * 1.0, door[1] + dz * 1.7 + pz * 1.0],
      [door[0] + dx * 1.7 - px * 1.2, door[1] + dz * 1.7 - pz * 1.2],
    ],
  };
}

/** Building plots, in the order new departments are offered them. */
export const SLOTS: Record<string, SlotLayout> = {
  north: facingCentre(0, -13.4),
  west: facingCentre(-12.6, 5.2),
  east: facingCentre(12.6, 5.2),
  south: facingCentre(0, 14.2),
  northwest: facingCentre(-11, -9),
  northeast: facingCentre(11, -9),
  southwest: facingCentre(-9.6, 14.6),
  southeast: facingCentre(9.6, 14.6),
  "far-west": facingCentre(-21, -3, 3.8),
  "far-east": facingCentre(21, -3, 3.8),
  "far-north": facingCentre(0, -21.6, 3.8),
};

export const SLOT_LABELS: Record<string, string> = {
  north: "North plaza",
  west: "West meadow",
  east: "East meadow",
  south: "South gate",
  northwest: "Northwest hill",
  northeast: "Northeast hill",
  southwest: "Southwest garden",
  southeast: "Southeast garden",
  "far-west": "Far west shore",
  "far-east": "Far east shore",
  "far-north": "Far north cliffs",
};

/**
 * Spare plots for buildings whose slot this theme doesn't define (e.g. created
 * under another theme). Chosen so they never overlap a designed plot or landmark.
 */
export const FALLBACK_SPOTS: [number, number][] = (() => {
  const spots: [number, number][] = [];
  const used: [number, number][] = Object.values(SLOTS).map((l) => [l.position[0], l.position[2]]);
  const f = FEATURES.field;
  const ps = pierStart();
  for (const r of [17.5, 21.5]) {
    for (let a = 0; a < Math.PI * 2; a += 0.04) {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (r + 4.8 > islandRadiusAt(a) - beachWidthAt(a)) continue;
      if (used.some(([ux, uz]) => Math.hypot(x - ux, z - uz) < 8.4)) continue;
      if (Math.hypot(x - f.center[0], z - f.center[1]) < f.rx + 4.5) continue;
      if (Math.hypot(x - FEATURES.picnic.center[0], z - FEATURES.picnic.center[1]) < 6.5) continue;
      if (Math.hypot(x - ps.x, z - ps.z) < 7) continue;
      if (Math.hypot(x - FEATURES.pond.center[0], z - FEATURES.pond.center[1]) < 7) continue;
      if (Math.hypot(x - FEATURES.garden.center[0], z - FEATURES.garden.center[1]) < 7) continue;
      spots.push([x, z]);
      used.push([x, z]);
    }
  }
  return spots;
})();

export function fallbackSlot(index: number): SlotLayout {
  if (index < FALLBACK_SPOTS.length) return facingCentre(...FALLBACK_SPOTS[index]);
  const a = (index * 2.39996) % (Math.PI * 2); // last resort: golden-angle spiral
  return facingCentre(Math.cos(a) * 17, Math.sin(a) * 17);
}

// ───────────── footprints & winding paths ─────────────

type P2 = [number, number];

/** Point in a building's local frame (door faces +z). */
export function toPlotLocal(layout: SlotLayout, x: number, z: number): P2 {
  const dx = x - layout.position[0];
  const dz = z - layout.position[2];
  const c = Math.cos(layout.rotation);
  const s = Math.sin(layout.rotation);
  // inverse of rotation about y by `rotation`
  return [dx * c - dz * s, dx * s + dz * c];
}

/** True if (x, z) is inside the plot (plus `pad`). */
export function inPlot(layout: SlotLayout, x: number, z: number, pad = 0): boolean {
  const [lx, lz] = toPlotLocal(layout, x, z);
  return Math.abs(lx) < PLOT.halfW + pad && lz > PLOT.zMin - pad && lz < PLOT.zMax + pad;
}

function hash(str: string): number {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}

/**
 * A gently winding path from the plaza ring to `end`, pushed around every
 * building plot it would cross (so custom departments never block a path).
 */
function windingPath(id: string, end: P2, plots: SlotLayout[], own?: SlotLayout): P2[] {
  const a = Math.atan2(end[1], end[0]);
  const start: P2 = [Math.cos(a) * RING_RADIUS, Math.sin(a) * RING_RADIUS];
  const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const n = Math.max(3, Math.round(len / 0.9));
  const px = -(end[1] - start[1]) / (len || 1);
  const pz = (end[0] - start[0]) / (len || 1);
  const bend = (hash(id) < 0.5 ? -1 : 1) * Math.min(1.1, len * 0.09);
  let pts: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const w = Math.sin(t * Math.PI) * bend * (1 - 0.35 * Math.sin(t * Math.PI * 2));
    pts.push([start[0] + (end[0] - start[0]) * t + px * w, start[1] + (end[1] - start[1]) * t + pz * w]);
  }
  // Push interior points out of other plots (a few relaxation passes).
  const others = plots.filter((p) => p !== own);
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (let i = 1; i < pts.length - 1; i++) {
      for (const o of others) {
        const [x, z] = pts[i];
        if (!inPlot(o, x, z, 0.9)) continue;
        const ox = x - o.position[0];
        const oz = z - o.position[2];
        const d = Math.hypot(ox, oz) || 1;
        const need = Math.hypot(PLOT.halfW, Math.max(-PLOT.zMin, PLOT.zMax)) + 1.0;
        pts[i] = [o.position[0] + (ox / d) * need, o.position[2] + (oz / d) * need];
        moved = true;
      }
    }
    // smooth
    pts = pts.map((p, i) =>
      i === 0 || i === pts.length - 1 ? p : ([(pts[i - 1][0] + p[0] * 2 + pts[i + 1][0]) / 4, (pts[i - 1][1] + p[1] * 2 + pts[i + 1][1]) / 4] as P2),
    );
    if (!moved) break;
  }
  return pts;
}

export interface TownPath {
  id: string;
  points: P2[];
}

/** All walkable paths besides the plaza ring: one per occupied plot, plus the pier and the picnic corner. */
export function townPaths(slots: Record<string, SlotLayout>): TownPath[] {
  const plots = Object.values(slots);
  const paths: TownPath[] = [];
  for (const [slot, layout] of Object.entries(slots)) paths.push({ id: `door:${slot}`, points: windingPath(slot, layout.door, plots, layout) });
  const ps = pierStart();
  paths.push({ id: "poi:pier", points: windingPath("pier", [ps.x, ps.z], plots) });
  const pc = FEATURES.picnic.center;
  paths.push({ id: "poi:picnic", points: windingPath("picnic", [pc[0] + 0.8, pc[1] - 1.6], plots) });
  // Garden gate and pond edge (each faces the plaza); skipped if a building took the spot.
  const toward = (c: P2, d: number): P2 => {
    const len = Math.hypot(c[0], c[1]);
    return [c[0] - (c[0] / len) * d, c[1] - (c[1] / len) * d];
  };
  const g = FEATURES.garden;
  if (!plots.some((p) => inPlot(p, g.center[0], g.center[1], 2.6))) paths.push({ id: "poi:garden", points: windingPath("garden", toward(g.center, g.d / 2 + 0.9), plots) });
  const pd = FEATURES.pond;
  if (!plots.some((p) => inPlot(p, pd.center[0], pd.center[1], 2.7))) paths.push({ id: "poi:pond", points: windingPath("pond", toward(pd.center, pd.rz + 1.1), plots) });
  return paths;
}

/** Path ring around the plaza plus every winding path, as a walk graph. */
export function buildNav(slots: Record<string, SlotLayout>): NavGraph {
  const nodes: NavGraph["nodes"] = {};
  const edges: NavGraph["edges"] = [];
  for (let i = 0; i < RING_NODES; i++) {
    const a = (i / RING_NODES) * Math.PI * 2;
    nodes[`r${i}`] = [Math.cos(a) * RING_RADIUS, Math.sin(a) * RING_RADIUS];
    edges.push([`r${i}`, `r${(i + 1) % RING_NODES}`]);
  }
  for (const path of townPaths(slots)) {
    const ids = path.points.map((_, i) => (i === path.points.length - 1 ? path.id : `${path.id}#${i}`));
    path.points.forEach((p, i) => (nodes[ids[i]] = p));
    for (let i = 1; i < ids.length; i++) edges.push([ids[i - 1], ids[i]]);
    // Join the path's first point to the two ring nodes either side of it.
    const a = (Math.atan2(path.points[0][1], path.points[0][0]) + Math.PI * 2) % (Math.PI * 2);
    const k = Math.floor((a / (Math.PI * 2)) * RING_NODES);
    edges.push([ids[0], `r${k % RING_NODES}`], [ids[0], `r${(k + 1) % RING_NODES}`]);
  }
  const hangouts: P2[] = [];
  for (let i = 0; i < RING_NODES; i += 3) hangouts.push(nodes[`r${i}`]);
  for (const id of ["poi:pier", "poi:picnic", "poi:garden", "poi:pond"]) if (nodes[id]) hangouts.push(nodes[id]);
  // On the plaza, near the benches.
  for (const a of [0.8, 2.4, 3.9, 5.5]) hangouts.push([Math.cos(a) * 4.1, Math.sin(a) * 4.1]);
  return { nodes, edges, hangouts };
}

type Preset = LightingPreset;
const P = (p: Omit<Preset, "sun"> & { sun: { color: string; intensity: number } }): Preset => ({ ...p, sun: { ...p.sun, position: [0, 30, 0] } });

const NIGHT = P({
  skyTop: "#1f2862", skyBottom: "#584a98", fog: "#3f4384",
  ambient: { color: "#a3b0ff", intensity: 0.42 },
  sun: { color: "#c8d4ff", intensity: 0.95 },
  hemi: { sky: "#8a96ee", ground: "#33545a", intensity: 0.62 },
  glow: 1, stars: 1, fireflies: 1, petals: 0,
});

/**
 * Lighting at local hours. The engine eases between neighbouring keyframes, so
 * every minute of the day looks slightly different. Low ambient + a strong key
 * light give shape and contrast by day; night stays bright enough to read the
 * town (moonlit blues, glowing windows, lanterns and fairy lights).
 */
export const LIGHTING_KEYFRAMES: LightingKeyframe[] = [
  { hour: 0, preset: NIGHT },
  { hour: 4.8, preset: NIGHT },
  {
    hour: 6.1,
    preset: P({
      skyTop: "#97a9f5", skyBottom: "#ffc3a0", fog: "#f1c9bb",
      ambient: { color: "#ffdccc", intensity: 0.42 },
      sun: { color: "#ffb388", intensity: 2.2 },
      hemi: { sky: "#ffd6e2", ground: "#a2c993", intensity: 0.75 },
      glow: 0.45, stars: 0.12, fireflies: 0.1, petals: 0.5,
    }),
  },
  {
    hour: 7.6,
    preset: P({
      skyTop: "#7cc2fb", skyBottom: "#fde3ee", fog: "#e4ecfb",
      ambient: { color: "#fff6ee", intensity: 0.26 },
      sun: { color: "#ffeed2", intensity: 2.6 },
      hemi: { sky: "#e0eeff", ground: "#9fc88e", intensity: 0.72 },
      glow: 0.05, stars: 0, fireflies: 0, petals: 1,
    }),
  },
  {
    hour: 12.5,
    preset: P({
      skyTop: "#62b2f6", skyBottom: "#e2f0ff", fog: "#d6e8f8",
      ambient: { color: "#ffffff", intensity: 0.24 },
      sun: { color: "#fff6e6", intensity: 3.0 },
      hemi: { sky: "#dcecff", ground: "#9ec58a", intensity: 0.78 },
      glow: 0, stars: 0, fireflies: 0, petals: 1,
    }),
  },
  {
    hour: 16.4,
    preset: P({
      skyTop: "#6bb2f0", skyBottom: "#fdebd8", fog: "#e9e2ea",
      ambient: { color: "#fff3e4", intensity: 0.24 },
      sun: { color: "#ffe6c0", intensity: 2.8 },
      hemi: { sky: "#efe6ff", ground: "#a3c483", intensity: 0.72 },
      glow: 0, stars: 0, fireflies: 0, petals: 0.9,
    }),
  },
  {
    hour: 18.0,
    preset: P({
      skyTop: "#7ea6ea", skyBottom: "#ffc97a", fog: "#f2cfa4",
      ambient: { color: "#ffe2c4", intensity: 0.32 },
      sun: { color: "#ffb766", intensity: 2.6 },
      hemi: { sky: "#ffe0b4", ground: "#a2c486", intensity: 0.72 },
      glow: 0.3, stars: 0, fireflies: 0.1, petals: 0.7,
    }),
  },
  {
    hour: 19.3,
    preset: P({
      skyTop: "#6c6ccb", skyBottom: "#ff9483", fog: "#de9fb3",
      ambient: { color: "#ffc0cf", intensity: 0.3 },
      sun: { color: "#ff8a74", intensity: 1.7 },
      hemi: { sky: "#c4a0ff", ground: "#86ad85", intensity: 0.6 },
      glow: 0.75, stars: 0.25, fireflies: 0.35, petals: 0.3,
    }),
  },
  {
    hour: 20.5,
    preset: P({
      skyTop: "#353a88", skyBottom: "#9f77ba", fog: "#635494",
      ambient: { color: "#b8b0ff", intensity: 0.4 },
      sun: { color: "#bcb6ff", intensity: 0.9 },
      hemi: { sky: "#8c8ae2", ground: "#3f6058", intensity: 0.6 },
      glow: 0.95, stars: 0.75, fireflies: 0.8, petals: 0,
    }),
  },
  { hour: 21.9, preset: NIGHT },
];

export const CAMERA = {
  fov: 32,
  overviewPosition: [38, 44, 46] as [number, number, number],
  overviewTarget: [2, 0, 3] as [number, number, number],
  minDistance: 10,
  maxDistance: 85,
  minPolar: 0.35,
  maxPolar: 1.18,
};

/** Deterministic PRNG so the village looks the same on every load. */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PASTELS = ["#ffb3c7", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff", "#a0c4ff", "#bdb2ff", "#ffc6ff"];
