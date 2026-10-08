import type { ComponentType } from "react";
import type { AgentStatus, Building } from "../../../shared/types";
import type { TimeOfDay } from "../state/store";

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
}

/** Animation state handed to the character component. */
export type CharacterAnim = "idle" | "walk" | "think" | "work" | "carry" | "wait" | "celebrate" | "sad";

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
      return "sad";
    default:
      return "idle";
  }
}

export interface CharacterProps {
  color: string;
  accessory: string;
  anim: CharacterAnim;
  moving: boolean;
  carrying: boolean;
  selected: boolean;
  hovered: boolean;
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
  timeOfDay: TimeOfDay;
  lighting: LightingPreset;
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
    slots: Record<string, SlotLayout>;
    /** Layout for buildings whose slot is not defined by this theme. */
    fallbackSlot: (index: number) => SlotLayout;
    nav: NavGraph;
    lighting: Record<TimeOfDay, LightingPreset>;
    camera: { fov: number; overviewPosition: Vec3; overviewTarget: Vec3; minDistance: number; maxDistance: number; minPolar: number; maxPolar: number };
    /** World units per second. */
    walkSpeed: number;
    /** Height of floating labels above an agent's feet. */
    labelHeight: number;
  };

  components: {
    Environment: ComponentType<EnvironmentProps>;
    Building: ComponentType<BuildingProps>;
    Character: ComponentType<CharacterProps>;
    /** Weather / ambient particles. Optional. */
    Weather?: ComponentType<{ timeOfDay: TimeOfDay }>;
  };

  audio: {
    /** Short procedural or sampled sound effects. */
    playSfx?: (id: SfxId, ctx: AudioContext) => void;
    /** Ambient music loop URL. `null` = this theme ships no music. */
    ambientUrl: string | null;
  };
}
