/**
 * Theme-agnostic day/night engine.
 *
 * The town follows the owner's real local time (IANA timezone, DST-aware via
 * shared/time.ts). Themes provide lighting KEYFRAMES at given local hours; this
 * module interpolates between them continuously, so the sky, sun, shadows,
 * windows, stars and fireflies change gradually through sunrise, daytime,
 * golden hour, sunset, evening and night. Pure functions (no three.js) so it is
 * unit-testable and shared by any theme.
 *
 * Weather is modelled as a separate input (`WeatherState`) that today is always
 * "clear"; a future weather source (API or simulation) only has to supply it.
 */
import { localHour } from "../../../shared/time";
import type { LightingPreset } from "../theme-engine/types";

export type DayPhase = "night" | "sunrise" | "morning" | "daytime" | "golden" | "sunset" | "evening";

export const PHASE_LABEL: Record<DayPhase, string> = {
  night: "Night",
  sunrise: "Sunrise",
  morning: "Morning",
  daytime: "Daytime",
  golden: "Golden hour",
  sunset: "Sunset",
  evening: "Evening",
};

export function phaseForHour(h: number): DayPhase {
  const x = ((h % 24) + 24) % 24;
  if (x < 5) return "night";
  if (x < 7) return "sunrise";
  if (x < 11) return "morning";
  if (x < 17) return "daytime";
  if (x < 18.75) return "golden";
  if (x < 20) return "sunset";
  if (x < 22) return "evening";
  return "night";
}

/** Manual lighting overrides (screenshots, customization, testing). Never touch schedules. */
export const LIGHTING_OVERRIDES: { id: DayPhase; hour: number; icon: string }[] = [
  { id: "sunrise", hour: 6.3, icon: "🌅" },
  { id: "daytime", hour: 12.5, icon: "☀️" },
  { id: "golden", hour: 18, icon: "🌇" },
  { id: "sunset", hour: 19.4, icon: "🌆" },
  { id: "night", hour: 23.5, icon: "🌙" },
];

export interface WeatherState {
  /** Only "clear" today. Planned: "rain", "snow", "fog", "windy", "storm". */
  kind: "clear";
  /** 0..1 strength of the weather effect. */
  intensity: number;
}

export interface EnvironmentState {
  /** Local hour used for lighting (real, or the override). */
  hour: number;
  /** Real local hour in the town timezone (the clock always shows this). */
  realHour: number;
  phase: DayPhase;
  lighting: LightingPreset;
  isOverride: boolean;
  timezone: string;
  weather: WeatherState;
}

export interface LightingKeyframe {
  hour: number;
  preset: LightingPreset;
}

// ───────────── interpolation helpers ─────────────

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${((c[0] << 16) | (c[1] << 8) | c[2]).toString(16).padStart(6, "0")}`;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Smoothstep easing so transitions don't have visible "kinks" at keyframes. */
const ease = (t: number) => t * t * (3 - 2 * t);

function lerpPreset(a: LightingPreset, b: LightingPreset, t: number): LightingPreset {
  return {
    skyTop: lerpHex(a.skyTop, b.skyTop, t),
    skyBottom: lerpHex(a.skyBottom, b.skyBottom, t),
    fog: lerpHex(a.fog, b.fog, t),
    ambient: { color: lerpHex(a.ambient.color, b.ambient.color, t), intensity: lerp(a.ambient.intensity, b.ambient.intensity, t) },
    sun: {
      color: lerpHex(a.sun.color, b.sun.color, t),
      intensity: lerp(a.sun.intensity, b.sun.intensity, t),
      position: a.sun.position.map((v, i) => lerp(v, b.sun.position[i], t)) as [number, number, number],
    },
    hemi: { sky: lerpHex(a.hemi.sky, b.hemi.sky, t), ground: lerpHex(a.hemi.ground, b.hemi.ground, t), intensity: lerp(a.hemi.intensity, b.hemi.intensity, t) },
    glow: lerp(a.glow, b.glow, t),
    stars: lerp(a.stars, b.stars, t),
    fireflies: lerp(a.fireflies, b.fireflies, t),
    petals: lerp(a.petals, b.petals, t),
  };
}

/**
 * Where the light comes from at `hour`: an arc from east (sunrise) through high
 * noon to west (sunset); a high, soft moon at night so shadows stay readable.
 */
export function sunPosition(hour: number): [number, number, number] {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 5.5 && h <= 20) {
    const t = (h - 5.5) / 14.5; // 0 at sunrise, 1 at dusk
    const a = Math.PI * t;
    // Never fully grazing: a little elevation keeps low-sun hours lit and colourful.
    return [Math.cos(a) * 34, 11 + Math.sin(a) * 27, 16];
  }
  return [-14, 28, -20];
}

/** Lighting at an hour, interpolated between the theme's keyframes (wraps around midnight). */
export function lightingAt(keyframes: LightingKeyframe[], hour: number): LightingPreset {
  const ks = [...keyframes].sort((a, b) => a.hour - b.hour);
  const h = ((hour % 24) + 24) % 24;
  let prev = ks[ks.length - 1];
  let next = ks[0];
  for (let i = 0; i < ks.length; i++) {
    if (ks[i].hour > h) {
      next = ks[i];
      prev = ks[(i - 1 + ks.length) % ks.length];
      break;
    }
    if (i === ks.length - 1) {
      prev = ks[i];
      next = ks[0];
    }
  }
  const span = (next.hour - prev.hour + 24) % 24 || 24;
  const t = ((h - prev.hour + 24) % 24) / span;
  const preset = lerpPreset(prev.preset, next.preset, ease(Math.min(1, Math.max(0, t))));
  return { ...preset, sun: { ...preset.sun, position: sunPosition(h) } };
}

export function environmentAt(opts: { now: Date; timezone: string; override: number | null; keyframes: LightingKeyframe[] }): EnvironmentState {
  let realHour: number;
  try {
    realHour = localHour(opts.now, opts.timezone);
  } catch {
    realHour = localHour(opts.now, "UTC");
  }
  const hour = opts.override ?? realHour;
  return {
    hour,
    realHour,
    phase: phaseForHour(hour),
    lighting: lightingAt(opts.keyframes, hour),
    isOverride: opts.override !== null,
    timezone: opts.timezone,
    weather: { kind: "clear", intensity: 0 },
  };
}

export function formatClock(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
