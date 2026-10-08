import type { LightingPreset, NavGraph, SlotLayout } from "../../theme-engine/types";
import type { LightingKeyframe } from "../../environment/dayCycle";

export const ISLAND_RADIUS = 26;
export const RING_RADIUS = 7;
const RING_NODES = 12;

/** Place a building at (x, z) facing the plaza centre. */
function facingCentre(x: number, z: number, doorOffset = 3.6): SlotLayout {
  const len = Math.hypot(x, z) || 1;
  const dx = -x / len;
  const dz = -z / len;
  const door: [number, number] = [x + dx * doorOffset, z + dz * doorOffset];
  // Perpendicular to the facing direction, for idle spots beside the building.
  const px = -dz;
  const pz = dx;
  return {
    position: [x, 0, z],
    rotation: Math.atan2(dx, dz),
    door,
    idleSpots: [
      [door[0] + px * 2.4, door[1] + pz * 2.4],
      [door[0] - px * 2.4, door[1] - pz * 2.4],
      [door[0] + dx * 1.2 + px * 1.2, door[1] + dz * 1.2 + pz * 1.2],
      [door[0] + dx * 1.4 - px * 1.6, door[1] + dz * 1.4 - pz * 1.6],
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

export function fallbackSlot(index: number): SlotLayout {
  const a = (index * 2.39996) % (Math.PI * 2); // golden-angle spiral
  return facingCentre(Math.cos(a) * 17, Math.sin(a) * 17);
}

/** Path ring around the plaza, plus a spoke from the ring to each occupied plot's door. */
export function buildNav(slots: Record<string, SlotLayout>): NavGraph {
  const nodes: NavGraph["nodes"] = {};
  const edges: NavGraph["edges"] = [];
  for (let i = 0; i < RING_NODES; i++) {
    const a = (i / RING_NODES) * Math.PI * 2;
    nodes[`r${i}`] = [Math.cos(a) * RING_RADIUS, Math.sin(a) * RING_RADIUS];
    edges.push([`r${i}`, `r${(i + 1) % RING_NODES}`]);
  }
  for (const [slot, layout] of Object.entries(slots)) {
    const id = `door:${slot}`;
    nodes[id] = layout.door;
    let best = "r0";
    let bestD = Infinity;
    for (let i = 0; i < RING_NODES; i++) {
      const [x, z] = nodes[`r${i}`];
      const d = Math.hypot(x - layout.door[0], z - layout.door[1]);
      if (d < bestD) (bestD = d), (best = `r${i}`);
    }
    edges.push([id, best]);
  }
  return { nodes, edges };
}

type Preset = LightingPreset;
const P = (p: Omit<Preset, "sun"> & { sun: { color: string; intensity: number } }): Preset => ({ ...p, sun: { ...p.sun, position: [0, 30, 0] } });

const NIGHT = P({
  skyTop: "#232c66", skyBottom: "#5d4f9e", fog: "#47478a",
  ambient: { color: "#a3b0ff", intensity: 0.6 },
  sun: { color: "#c8d4ff", intensity: 0.85 },
  hemi: { sky: "#7f8ce6", ground: "#3d5a5a", intensity: 0.6 },
  glow: 1, stars: 1, fireflies: 1, petals: 0,
});

/**
 * Lighting at local hours. The engine eases between neighbouring keyframes, so
 * every minute of the day looks slightly different. Night stays bright enough
 * to read the town (moonlit blues, glowing windows and lamps).
 */
export const LIGHTING_KEYFRAMES: LightingKeyframe[] = [
  { hour: 0, preset: NIGHT },
  { hour: 4.8, preset: NIGHT },
  {
    hour: 6.1,
    preset: P({
      skyTop: "#a8b6ff", skyBottom: "#ffc6a6", fog: "#f5cfc4",
      ambient: { color: "#ffe0d2", intensity: 0.56 },
      sun: { color: "#ffb385", intensity: 1.4 },
      hemi: { sky: "#ffd3e0", ground: "#a6d69c", intensity: 0.55 },
      glow: 0.45, stars: 0.15, fireflies: 0.1, petals: 0.5,
    }),
  },
  {
    hour: 7.6,
    preset: P({
      skyTop: "#8ccdff", skyBottom: "#fde4ef", fog: "#e8efff",
      ambient: { color: "#fff8f2", intensity: 0.62 },
      sun: { color: "#fff0d8", intensity: 2.0 },
      hemi: { sky: "#e3f0ff", ground: "#bfe8bd", intensity: 0.6 },
      glow: 0.05, stars: 0, fireflies: 0, petals: 1,
    }),
  },
  {
    hour: 12.5,
    preset: P({
      skyTop: "#78c2ff", skyBottom: "#eaf4ff", fog: "#e2eeff",
      ambient: { color: "#ffffff", intensity: 0.6 },
      sun: { color: "#fffaf0", intensity: 2.45 },
      hemi: { sky: "#e6f2ff", ground: "#c4ecc0", intensity: 0.62 },
      glow: 0, stars: 0, fireflies: 0, petals: 1,
    }),
  },
  {
    hour: 16.4,
    preset: P({
      skyTop: "#7fbef7", skyBottom: "#fdeedd", fog: "#efe9f2",
      ambient: { color: "#fff6ea", intensity: 0.6 },
      sun: { color: "#ffeccc", intensity: 2.25 },
      hemi: { sky: "#f2ecff", ground: "#c4e6b4", intensity: 0.6 },
      glow: 0, stars: 0, fireflies: 0, petals: 0.9,
    }),
  },
  {
    hour: 18.0,
    preset: P({
      skyTop: "#8cb0ee", skyBottom: "#ffcf86", fog: "#f5d4ad",
      ambient: { color: "#ffe4c4", intensity: 0.56 },
      sun: { color: "#ffbd6b", intensity: 2.05 },
      hemi: { sky: "#ffdfae", ground: "#acd48c", intensity: 0.56 },
      glow: 0.3, stars: 0, fireflies: 0.1, petals: 0.7,
    }),
  },
  {
    hour: 19.3,
    preset: P({
      skyTop: "#7b7bd4", skyBottom: "#ff9a88", fog: "#e6a7b8",
      ambient: { color: "#ffc6d2", intensity: 0.52 },
      sun: { color: "#ff8e78", intensity: 1.35 },
      hemi: { sky: "#c8a6ff", ground: "#9cc496", intensity: 0.52 },
      glow: 0.7, stars: 0.25, fireflies: 0.35, petals: 0.3,
    }),
  },
  {
    hour: 20.5,
    preset: P({
      skyTop: "#3a3e8c", skyBottom: "#a47cbe", fog: "#6a5a9a",
      ambient: { color: "#bab2ff", intensity: 0.56 },
      sun: { color: "#bcb6ff", intensity: 0.8 },
      hemi: { sky: "#8c8ae2", ground: "#46685e", intensity: 0.56 },
      glow: 0.95, stars: 0.75, fireflies: 0.8, petals: 0,
    }),
  },
  { hour: 21.9, preset: NIGHT },
];

export const CAMERA = {
  fov: 32,
  overviewPosition: [30, 34, 34] as [number, number, number],
  overviewTarget: [0, 0, 0] as [number, number, number],
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
