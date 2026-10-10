import type { SkillDefinition } from "./types.js";

/**
 * Declared capability slots with NO integration yet. They are listed so the UI,
 * templates and buildings can be designed around them. Agents may carry them
 * (e.g. a Designer hired today), but they contribute NO tools and NO prompt
 * until a real provider module replaces the stub — the UI labels them inactive.
 */
export const imageGeneration: SkillDefinition = {
  id: "image_generation",
  label: "Image generation",
  shortLabel: "Images",
  icon: "🎨",
  category: "media",
  description: "Generate and edit images (e.g. ad creatives, illustrations). Requires an image-model provider — planned, not connected.",
  status: "planned",
  tools: [],
  prompt: null,
  costNote: "Will depend on the image provider you connect.",
  verificationCheck: null,
};

export const modeling3d: SkillDefinition = {
  id: "3d_modeling",
  label: "3D modeling",
  shortLabel: "3D",
  icon: "🧊",
  category: "3d",
  description: "Create 3D models and scenes (e.g. product mock-ups, theme assets). Requires a 3D-generation provider — planned, not connected.",
  status: "planned",
  tools: [],
  prompt: null,
  costNote: "Will depend on the 3D provider you connect.",
  verificationCheck: null,
};
