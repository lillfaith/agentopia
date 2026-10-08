import type { Appearance, VoiceConfig } from "../../shared/cosmetics.js";

/** Default looks and voices for the three founding villagers (fresh towns and upgrades). */
export const SEED_LOOKS: Record<string, { appearance: Appearance; voice: VoiceConfig }> = {
  manager: {
    appearance: {
      bodyColor: "#f59ab8",
      accentColor: "#ffe0ea",
      cheekColor: "#ff7fa6",
      eyes: "sparkle",
      expression: "smile",
      ears: "cat",
      tail: "puff",
      size: 1.05,
      wearables: { head: "crown", neck: "bow-tie" },
    },
    voice: { preset: "gentle", pitch: 0, speed: 1, tone: 0.55, texture: 0.15 },
  },
  researcher: {
    appearance: {
      bodyColor: "#8ccbf2",
      accentColor: "#e3f4ff",
      cheekColor: "#ffa3bf",
      eyes: "round",
      expression: "calm",
      ears: "floppy",
      tail: "none",
      size: 0.95,
      wearables: { eyes: "goggles", back: "backpack", hand: "book" },
    },
    voice: { preset: "squeaky", pitch: 2, speed: 1.1, tone: 0.6, texture: 0.1 },
  },
  copywriter: {
    appearance: {
      bodyColor: "#b9a7fa",
      accentColor: "#efeaff",
      cheekColor: "#ff9fc4",
      eyes: "happy",
      expression: "cat",
      ears: "bear",
      tail: "curly",
      size: 1,
      wearables: { head: "beret", neck: "scarf", hand: "quill" },
    },
    voice: { preset: "bubbly", pitch: 0, speed: 1, tone: 0.5, texture: 0.25 },
  },
};
