import type { ThemeManifest } from "../../theme-engine/types";
import { playPastelSfx } from "./audio";
import { PastelBuilding } from "./Buildings";
import { PastelCharacter } from "./Character";
import { PastelEnvironment } from "./Environment";
import { CAMERA, LIGHTING_KEYFRAMES, SLOTS, SLOT_LABELS, buildNav, fallbackSlot } from "./layout";
import { UI_VARS } from "./palette";
import { PastelWeather } from "./Weather";

/** "Pastel Village" — the original default theme for Agentopia. */
export const pastelVillage: ThemeManifest = {
  id: "pastel-village",
  name: "Pastel Village",
  version: "1.2.0",
  author: "Agentopia",
  description: "A pink fantasy island village: a flagstone square, winding cobble lanes, timber cottages, a hyacinth field, a beach and a lantern-lit pier.",
  ui: {
    cssVars: UI_VARS,
    fontStylesheet: "https://fonts.googleapis.com/css2?family=Nunito:wght@500;700;800;900&display=swap",
    icons: {
      tasks: "📋",
      town: "🏘️",
      schedules: "📅",
      projects: "🎁",
      "new-project": "✨",
      log: "📜",
      approvals: "🔔",
      treasury: "💰",
      settings: "⚙️",
      overview: "🗺️",
      follow: "🎯",
      names: "🏷️",
      bubbles: "💬",
      soundOn: "🔊",
      soundOff: "🔈",
      dawn: "🌅",
      day: "☀️",
      dusk: "🌇",
      night: "🌙",
    },
  },
  world: {
    slots: SLOTS,
    slotLabels: SLOT_LABELS,
    fallbackSlot,
    buildNav,
    buildingStyles: [
      { kind: "hq", label: "Town Hall", icon: "🏰", description: "Timber-framed hall with towers, a clock gable and a task board — for management." },
      { kind: "research", label: "Observatory", icon: "🔭", description: "Stone tower, balcony and turning dome, with a telescope and globe in the yard." },
      { kind: "studio", label: "Cottage studio", icon: "🪶", description: "Half-timbered cottage with posters, a typewriter desk and a giant quill." },
      { kind: "workshop", label: "Workshop", icon: "⚙️", description: "Brick workshop with a barn door, gears, crates and a workbench prototype — for engineering." },
      { kind: "atelier", label: "Glass atelier", icon: "🎨", description: "Greenhouse studio with an easel, paint pots and potted flowers — for design." },
      { kind: "lab", label: "Crystal lab", icon: "🧊", description: "A crystal dome with orbiting rings — for 3D and experiments." },
    ],
    lightingKeyframes: LIGHTING_KEYFRAMES,
    camera: CAMERA,
    walkSpeed: 2.6,
    labelHeight: 2.7,
    // Neutral tone mapping keeps pastel hues true instead of ACES' washed-out highlights.
    renderer: { toneMapping: "neutral", exposure: 1.0, fog: [95, 240] },
  },
  components: {
    Environment: PastelEnvironment,
    Building: PastelBuilding,
    Character: PastelCharacter,
    Weather: PastelWeather,
  },
  audio: {
    playSfx: playPastelSfx,
    ambientUrl: null, // Placeholder: no music ships with Phase 1.
  },
};
