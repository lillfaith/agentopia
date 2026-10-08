import type { ThemeManifest } from "../../theme-engine/types";
import { playPastelSfx } from "./audio";
import { PastelBuilding } from "./Buildings";
import { PastelCharacter } from "./Character";
import { PastelEnvironment } from "./Environment";
import { CAMERA, LIGHTING_KEYFRAMES, SLOTS, SLOT_LABELS, buildNav, fallbackSlot } from "./layout";
import { PastelWeather } from "./Weather";

/** "Pastel Village" — the original default theme for Agentopia. */
export const pastelVillage: ThemeManifest = {
  id: "pastel-village",
  name: "Pastel Village",
  version: "1.0.0",
  author: "Agentopia",
  description: "A cosy candy-coloured island village with mushroom trees, a rainbow path and round little villagers.",
  ui: {
    cssVars: {
      "--font": "'Nunito', ui-rounded, 'SF Pro Rounded', system-ui, sans-serif",
      "--bg": "#fdf2f8",
      "--panel": "rgba(255, 255, 255, 0.86)",
      "--panel-solid": "#fffafd",
      "--panel-border": "rgba(236, 180, 210, 0.55)",
      "--text": "#4a3b5c",
      "--muted": "#9a88ad",
      "--accent": "#ff7eb3",
      "--accent-2": "#8f7cff",
      "--accent-soft": "#ffe1ef",
      "--good": "#3fbf8f",
      "--warn": "#f5a623",
      "--bad": "#ef5f7a",
      "--info": "#5aa9f0",
      "--chip": "rgba(255, 255, 255, 0.9)",
      "--radius": "18px",
      "--shadow": "0 10px 30px rgba(170, 110, 160, 0.18), 0 2px 6px rgba(170, 110, 160, 0.12)",
    },
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
      { kind: "hq", label: "Town Hall", icon: "🏰", description: "Turrets, a clock and a pennant — for management." },
      { kind: "research", label: "Observatory", icon: "🔭", description: "A domed tower with a rotating telescope." },
      { kind: "studio", label: "Cottage studio", icon: "🪶", description: "A gabled cottage with a giant quill and inkpot." },
      { kind: "workshop", label: "Workshop", icon: "⚙️", description: "A tinkerer's workshop with spinning gears — for engineering." },
      { kind: "atelier", label: "Glass atelier", icon: "🎨", description: "A bright greenhouse studio with an easel — for design." },
      { kind: "lab", label: "Crystal lab", icon: "🧊", description: "A crystal dome with orbiting rings — for 3D and experiments." },
    ],
    lightingKeyframes: LIGHTING_KEYFRAMES,
    camera: CAMERA,
    walkSpeed: 2.6,
    labelHeight: 2.7,
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
