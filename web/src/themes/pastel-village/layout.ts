import type { LightingPreset, NavGraph, SlotLayout } from "../../theme-engine/types";
import type { TimeOfDay } from "../../state/store";

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

export const SLOTS: Record<string, SlotLayout> = {
  north: facingCentre(0, -13.4),
  west: facingCentre(-12.6, 5.2),
  east: facingCentre(12.6, 5.2),
  // Reserved for future departments.
  south: facingCentre(0, 14.2),
  northwest: facingCentre(-11, -9),
  northeast: facingCentre(11, -9),
};

export function fallbackSlot(index: number): SlotLayout {
  const a = (index * 2.39996) % (Math.PI * 2); // golden-angle spiral
  return facingCentre(Math.cos(a) * 17, Math.sin(a) * 17);
}

/** Path ring around the plaza, plus a spoke from the ring to every slot's door. */
function buildNav(): NavGraph {
  const nodes: NavGraph["nodes"] = {};
  const edges: NavGraph["edges"] = [];
  for (let i = 0; i < RING_NODES; i++) {
    const a = (i / RING_NODES) * Math.PI * 2;
    nodes[`r${i}`] = [Math.cos(a) * RING_RADIUS, Math.sin(a) * RING_RADIUS];
    edges.push([`r${i}`, `r${(i + 1) % RING_NODES}`]);
  }
  for (const [slot, layout] of Object.entries(SLOTS)) {
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

export const NAV = buildNav();

/** Plaza spots around the fountain where idle villagers like to hang out. */
export const PLAZA_SPOTS: [number, number][] = [
  [2.6, 1.6],
  [-2.4, 2.0],
  [0.4, 3.2],
  [-1.8, -2.6],
  [2.2, -2.4],
];

export const LIGHTING: Record<TimeOfDay, LightingPreset> = {
  dawn: {
    skyTop: "#b9c6ff",
    skyBottom: "#ffd6e0",
    fog: "#f6d9e6",
    ambient: { color: "#ffe3ec", intensity: 0.55 },
    sun: { color: "#ffc6a8", intensity: 1.6, position: [-30, 14, 18] },
    hemi: { sky: "#ffd9e8", ground: "#b5e3c0", intensity: 0.55 },
    glow: 0.35,
  },
  day: {
    skyTop: "#9fd8ff",
    skyBottom: "#fde7f3",
    fog: "#e9f1ff",
    ambient: { color: "#ffffff", intensity: 0.65 },
    sun: { color: "#fff6ea", intensity: 2.2, position: [18, 30, 14] },
    hemi: { sky: "#e6f2ff", ground: "#c8f0c9", intensity: 0.6 },
    glow: 0,
  },
  dusk: {
    skyTop: "#8f8be0",
    skyBottom: "#ffb3a7",
    fog: "#e8b8c8",
    ambient: { color: "#ffd0d8", intensity: 0.5 },
    sun: { color: "#ff9f8a", intensity: 1.4, position: [30, 10, -12] },
    hemi: { sky: "#c9a7ff", ground: "#a7cfa0", intensity: 0.45 },
    glow: 0.65,
  },
  night: {
    skyTop: "#1d2350",
    skyBottom: "#5b4a8f",
    fog: "#3a3a6e",
    ambient: { color: "#8fa0ff", intensity: 0.35 },
    sun: { color: "#b8c4ff", intensity: 0.55, position: [-14, 26, -20] },
    hemi: { sky: "#6c78d8", ground: "#2f4a48", intensity: 0.35 },
    glow: 1,
  },
};

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
