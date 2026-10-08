import type { ComponentType } from "react";
import type { AgentStatus, Building } from "../../../shared/types";
import type { Appearance } from "../../../shared/cosmetics";
import type { EnvironmentState, LightingKeyframe } from "../environment/dayCycle";

/**
 * THEME CONTRACT
 * A theme is a pure presentation package. It receives read-only, theme-agnostic
 * data (agent avatar colour + accessory keyword, animation state, building kind)
 * and decides how everything looks and sounds. Themes never talk to the API,
 * never see prompts, tasks contents or keys, and can be swapped at runtime
 * without touching agents, tasks, integrations or saved data.
 */

export type Vec3 = [number, number, number];

export interface LightingPreset {
  skyTop: string;
  skyBottom: string;
  fog: string;
  ambient: { color: string; intensity: number };
  sun: { color: string; intensity: number; position: Vec3 };
  hemi: { sky: string; ground: string; intensity: number };
  /** 0..1 — how strongly lamps/windows glow. */
  glow: number;
  /** 0..1 — star field visibility. */
  stars: number;
  /** 0..1 — firefly density. */
  fireflies: number;
  /** 0..1 — drifting blossom petals (daytime ambience). */
  petals: number;
}

export interface SlotLayout {
  /** Building origin on the ground plane. */
  position: Vec3;
  /** Y rotation (radians) so the door faces the plaza. */
  rotation: number;
  /** Where agents stand when they "work at" or "visit" this building (x, z). */
  door: [number, number];
  /** Spots near the building used for idle wandering (x, z). */
  idleSpots: [number, number][];
}

export interface NavGraph {
  /** Waypoints on walkable paths (x, z). */
  nodes: Record<string, [number, number]>;
  edges: [string, string][];
  /** Optional spots idle villagers like to visit (benches, a pier, a picnic). Decorative only. */
  hangouts?: [number, number][];
}

/**
 * Animation state handed to the character component.
 *
 * WORK states are chosen ONLY from real agent status / real hand-off events:
 *   think (planning) · work · sit-work (working at an interior desk) · read · write ·
 *   carry (a real hand-off) · wait (needs approval) · celebrate (task completed) · confused (task failed)
 * DECORATIVE states are idle-only flavour and never imply task progress:
 *   idle · walk · rest · sleep · converse
 */
export type CharacterAnim =
  | "idle"
  | "walk"
  | "think"
  | "work"
  | "sit-work"
  | "read"
  | "write"
  | "carry"
  | "wait"
  | "celebrate"
  | "confused"
  | "rest"
  | "sleep"
  | "converse";

export const WORK_ANIMS: ReadonlySet<CharacterAnim> = new Set(["think", "work", "sit-work", "read", "write", "carry", "wait", "celebrate", "confused"]);

export function animForStatus(status: AgentStatus): CharacterAnim {
  switch (status) {
    case "planning":
      return "think";
    case "working":
      return "work";
    case "delivering":
      return "carry";
    case "waiting_approval":
      return "wait";
    case "completed":
      return "celebrate";
    case "failed":
      return "confused";
    default:
      return "idle";
  }
}

export interface CharacterProps {
  appearance: Appearance;
  anim: CharacterAnim;
  moving: boolean;
  carrying: boolean;
  selected: boolean;
  hovered: boolean;
  /** True while the villager's voice is speaking (mouth flaps). */
  talking?: boolean;
}

export interface BuildingProps {
  building: Building;
  glow: number;
  hovered: boolean;
  selected: boolean;
  /** Number of agents currently working inside (for lit windows, chimney smoke, ...). */
  activity: number;
}

export interface EnvironmentProps {
  /** Real-time lighting, phase and weather (see environment/dayCycle.ts). */
  env: EnvironmentState;
  /** Occupied slots so decorations can avoid them. */
  slots: Record<string, SlotLayout>;
}

export type SfxId = "click" | "open" | "complete" | "approval" | "fail" | "handoff" | "start";

export interface ThemeManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;

  ui: {
    /** CSS custom properties applied to :root (colours, radii, shadows, fonts). */
    cssVars: Record<string, string>;
    /** Optional stylesheet URL for the theme's font. */
    fontStylesheet?: string;
    /** Emoji/icon per UI panel, so packs can restyle the dock. */
    icons: Record<string, string>;
  };

  world: {
    /** Named building plots, in the order new departments are offered them. */
    slots: Record<string, SlotLayout>;
    /** Friendly names for plots, shown when building a new department. */
    slotLabels: Record<string, string>;
    /** Layout for buildings whose slot is not defined by this theme. */
    fallbackSlot: (index: number) => SlotLayout;
    /** Walkable path graph for the plots that are currently occupied. */
    buildNav: (occupied: Record<string, SlotLayout>) => NavGraph;
    /** Building styles this theme can draw (any other kind gets a generic fallback). */
    buildingStyles: { kind: string; label: string; icon: string; description: string }[];
    /** Lighting at local hours; the engine interpolates between them through the day. */
    lightingKeyframes: LightingKeyframe[];
    camera: { fov: number; overviewPosition: Vec3; overviewTarget: Vec3; minDistance: number; maxDistance: number; minPolar: number; maxPolar: number };
    /** World units per second. */
    walkSpeed: number;
    /** Height of floating labels above an agent's feet. */
    labelHeight: number;
    /** Optional renderer look. Defaults: ACES tone mapping, exposure 1, fog 70–190. */
    renderer?: { toneMapping?: "aces" | "neutral" | "agx"; exposure?: number; fog?: [near: number, far: number] };
  };

  components: {
    Environment: ComponentType<EnvironmentProps>;
    Building: ComponentType<BuildingProps>;
    Character: ComponentType<CharacterProps>;
    /** Weather / ambient particles. Optional. */
    Weather?: ComponentType<{ env: EnvironmentState }>;
  };

  audio: {
    /** Short procedural or sampled sound effects. */
    playSfx?: (id: SfxId, ctx: AudioContext) => void;
    /** Ambient music loop URL. `null` = this theme ships no music. */
    ambientUrl: string | null;
  };
}
