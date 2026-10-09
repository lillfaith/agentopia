/**
 * Cosmetic identity of a villager: body, face, features, wearables and voice.
 *
 * Purely presentational. Nothing here is sent to the model, changes tools or
 * permissions, or affects cost — enforced by tests. Item ids are theme-agnostic:
 * themes decide how each id looks, and fall back gracefully for ids they don't
 * know, so cosmetic packs and visual themes can ship independently.
 */

export const WEARABLE_SLOTS = ["head", "eyes", "neck", "back", "hand"] as const;
export type WearableSlot = (typeof WEARABLE_SLOTS)[number];

export interface WearableItem {
  id: string;
  name: string;
  slot: WearableSlot;
  icon: string;
  description: string;
  /** Cosmetic pack the item ships in ("core" = built in, free). */
  pack: string;
  /** Price in town coins (earned from verified work; no cash value). Absent = free. */
  price?: number;
}

/** Built-in "core" pack. All original designs. */
export const WEARABLES: WearableItem[] = [
  // head
  { id: "ribbon-bow", name: "Ribbon bow", slot: "head", icon: "🎀", description: "A big satin bow, slightly tilted.", pack: "core" },
  { id: "sun-hat", name: "Sun hat", slot: "head", icon: "👒", description: "Wide straw brim with a ribbon band.", pack: "core" },
  { id: "crown", name: "Little crown", slot: "head", icon: "👑", description: "Five-point golden crown with a heart gem.", pack: "core" },
  { id: "beret", name: "Painter's beret", slot: "head", icon: "🎨", description: "A soft beret with a stem on top.", pack: "core" },
  { id: "flower-crown", name: "Flower crown", slot: "head", icon: "🌼", description: "A ring of tiny pastel blossoms.", pack: "core" },
  { id: "beanie", name: "Cosy beanie", slot: "head", icon: "🧶", description: "Knitted beanie with a pom-pom.", pack: "core" },
  { id: "headphones", name: "Headphones", slot: "head", icon: "🎧", description: "Chunky over-ear headphones.", pack: "core" },
  { id: "sprout", name: "Sprout", slot: "head", icon: "🌱", description: "A two-leaf sprout growing from the head.", pack: "core" },
  { id: "tiara", name: "Rose tiara", slot: "head", icon: "💎", description: "A delicate tiara with a pink heart jewel.", pack: "core" },
  { id: "sakura-pin", name: "Sakura hairpin", slot: "head", icon: "🌸", description: "A spray of cherry blossoms tucked behind one ear.", pack: "core" },
  // eyes
  { id: "round-glasses", name: "Round glasses", slot: "eyes", icon: "👓", description: "Thin gold wire frames.", pack: "core" },
  { id: "star-shades", name: "Star shades", slot: "eyes", icon: "⭐", description: "Star-shaped sunglasses.", pack: "core" },
  { id: "goggles", name: "Inventor goggles", slot: "eyes", icon: "🥽", description: "Rose-gold goggles pushed up on the forehead.", pack: "core" },
  { id: "heart-shades", name: "Heart shades", slot: "eyes", icon: "💗", description: "Heart-shaped sunglasses with pink lenses.", pack: "core" },
  // neck
  { id: "scarf", name: "Knit scarf", slot: "neck", icon: "🧣", description: "A warm striped scarf with a tail.", pack: "core" },
  { id: "bow-tie", name: "Bow tie", slot: "neck", icon: "🎗️", description: "A dapper little bow tie.", pack: "core" },
  { id: "flower-lei", name: "Flower garland", slot: "neck", icon: "🌺", description: "A loop of bright flowers.", pack: "core" },
  { id: "pearls", name: "Pearl necklace", slot: "neck", icon: "🦪", description: "A string of blush pearls.", pack: "core" },
  { id: "ruffle-collar", name: "Ruffle collar", slot: "neck", icon: "🎀", description: "A frilly lace collar with a little bow.", pack: "core" },
  // back
  { id: "backpack", name: "Explorer backpack", slot: "back", icon: "🎒", description: "A round backpack with a buckle.", pack: "core" },
  { id: "fairy-wings", name: "Fairy wings", slot: "back", icon: "🧚", description: "Translucent shimmering wings.", pack: "core" },
  { id: "cape", name: "Hero cape", slot: "back", icon: "🦸", description: "A short flowing cape.", pack: "core" },
  { id: "heart-pack", name: "Heart backpack", slot: "back", icon: "💝", description: "A plush heart-shaped backpack.", pack: "core" },
  // hand
  { id: "book", name: "Storybook", slot: "hand", icon: "📘", description: "A small hardback book.", pack: "core" },
  { id: "coffee", name: "Coffee cup", slot: "hand", icon: "☕", description: "A steaming mug.", pack: "core" },
  { id: "quill", name: "Feather quill", slot: "hand", icon: "🪶", description: "A long feather pen.", pack: "core" },
  { id: "wrench", name: "Tiny wrench", slot: "hand", icon: "🔧", description: "For tightening tiny bolts.", pack: "core" },
  { id: "bouquet", name: "Bouquet", slot: "hand", icon: "💐", description: "A small bunch of flowers.", pack: "core" },
  { id: "parasol", name: "Lace parasol", slot: "hand", icon: "⛱️", description: "A frilly pink parasol.", pack: "core" },
];

/** Boutique pack: bought with coins in the town shop. */
WEARABLES.push(
  { id: "star-halo", name: "Star halo", slot: "head", icon: "🌟", description: "A golden halo ringed with tiny stars.", pack: "boutique", price: 120 },
  { id: "heart-crown", name: "Heart crown", slot: "head", icon: "💖", description: "A rose-gold band topped with little hearts.", pack: "boutique", price: 200 },
  { id: "heart-locket", name: "Heart locket", slot: "neck", icon: "💞", description: "A gold chain with a glowing heart pendant.", pack: "boutique", price: 90 },
  { id: "heart-wings", name: "Heart wings", slot: "back", icon: "💗", description: "Four plush hearts that flutter like wings.", pack: "boutique", price: 180 },
  { id: "star-wand", name: "Star wand", slot: "hand", icon: "🪄", description: "A slim wand with a twinkling star.", pack: "boutique", price: 100 },
  { id: "heart-balloon", name: "Heart balloon", slot: "hand", icon: "🎈", description: "A shiny heart balloon on a ribbon.", pack: "boutique", price: 60 },
);

export const EYE_STYLES = ["round", "sparkle", "sleepy", "happy", "dot", "wink"] as const;
export const EXPRESSIONS = ["smile", "grin", "calm", "cat", "surprised"] as const;
export const EAR_STYLES = ["none", "bear", "bunny", "cat", "floppy", "horns", "antenna"] as const;
export const TAIL_STYLES = ["none", "puff", "cat", "fox", "curly"] as const;

export type EyeStyle = (typeof EYE_STYLES)[number];
export type Expression = (typeof EXPRESSIONS)[number];
export type EarStyle = (typeof EAR_STYLES)[number];
export type TailStyle = (typeof TAIL_STYLES)[number];

export interface Appearance {
  bodyColor: string;
  /** Belly / inner-ear colour. */
  accentColor: string;
  cheekColor: string;
  eyes: EyeStyle;
  /** Resting expression; animations may change it temporarily (e.g. worried on errors). */
  expression: Expression;
  ears: EarStyle;
  tail: TailStyle;
  /** 0.85 – 1.2 */
  size: number;
  wearables: Partial<Record<WearableSlot, string>>;
}

export const VOICE_PRESET_IDS = ["squeaky", "bubbly", "sleepy", "robotic", "gentle", "energetic"] as const;
export type VoicePresetId = (typeof VOICE_PRESET_IDS)[number];

export interface VoiceConfig {
  preset: VoicePresetId;
  /** Semitone offset from the preset, -12 … 12. */
  pitch: number;
  /** Speaking-rate multiplier, 0.5 … 2. */
  speed: number;
  /** Brightness of the timbre, 0 … 1. */
  tone: number;
  /** Amount of breath/grit/bit-crunch texture, 0 … 1. */
  texture: number;
}

export function wearable(id: string | undefined): WearableItem | undefined {
  return id ? WEARABLES.find((w) => w.id === id) : undefined;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function mix(hex: string, toward: string, t: number): string {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(toward.slice(1), 16);
  const ch = (x: number, s: number) => (x >> s) & 255;
  const c = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, "0")}`;
}

/** A pleasant default look derived from a body colour (used for new and migrated villagers). */
export function defaultAppearance(bodyColor = "#f6a5c0", headItem?: string): Appearance {
  const body = HEX.test(bodyColor) ? bodyColor : "#f6a5c0";
  const wearables: Appearance["wearables"] = {};
  const item = wearable(headItem);
  if (item) wearables[item.slot] = item.id;
  return {
    bodyColor: body,
    accentColor: mix(body, "#ffffff", 0.6),
    cheekColor: "#ff9fb8",
    eyes: "round",
    expression: "smile",
    ears: "none",
    tail: "none",
    size: 1,
    wearables,
  };
}

export function defaultVoice(preset: VoicePresetId = "bubbly"): VoiceConfig {
  return { preset, pitch: 0, speed: 1, tone: 0.5, texture: 0.2 };
}

/** Coerce stored/unknown data into a valid Appearance (unknown wearable ids are dropped). */
export function normalizeAppearance(raw: unknown, fallbackColor = "#f6a5c0"): Appearance {
  const base = defaultAppearance(fallbackColor);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<Appearance>;
  const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
  const wearables: Appearance["wearables"] = {};
  for (const slot of WEARABLE_SLOTS) {
    const id = r.wearables?.[slot];
    const item = wearable(id);
    if (item && item.slot === slot) wearables[slot] = item.id;
  }
  return {
    bodyColor: HEX.test(r.bodyColor ?? "") ? r.bodyColor! : base.bodyColor,
    accentColor: HEX.test(r.accentColor ?? "") ? r.accentColor! : mix(HEX.test(r.bodyColor ?? "") ? r.bodyColor! : base.bodyColor, "#ffffff", 0.6),
    cheekColor: HEX.test(r.cheekColor ?? "") ? r.cheekColor! : base.cheekColor,
    eyes: pick(r.eyes, EYE_STYLES, base.eyes),
    expression: pick(r.expression, EXPRESSIONS, base.expression),
    ears: pick(r.ears, EAR_STYLES, base.ears),
    tail: pick(r.tail, TAIL_STYLES, base.tail),
    size: typeof r.size === "number" && Number.isFinite(r.size) ? Math.min(1.2, Math.max(0.85, r.size)) : 1,
    wearables,
  };
}

export function normalizeVoice(raw: unknown): VoiceConfig {
  const d = defaultVoice();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Partial<VoiceConfig>;
  const clamp = (v: unknown, lo: number, hi: number, dv: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dv);
  return {
    preset: VOICE_PRESET_IDS.includes(r.preset as VoicePresetId) ? (r.preset as VoicePresetId) : d.preset,
    pitch: clamp(r.pitch, -12, 12, 0),
    speed: clamp(r.speed, 0.5, 2, 1),
    tone: clamp(r.tone, 0, 1, 0.5),
    texture: clamp(r.texture, 0, 1, 0.2),
  };
}
