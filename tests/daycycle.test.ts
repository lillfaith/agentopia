import { describe, expect, it } from "vitest";
import { environmentAt, lightingAt, phaseForHour, sunPosition, lerpHex } from "../web/src/environment/dayCycle";
import { LIGHTING_KEYFRAMES } from "../web/src/themes/pastel-village/layout";
import { localHour } from "../shared/time";

const at = (iso: string, tz: string, override: number | null = null) => environmentAt({ now: new Date(iso), timezone: tz, override, keyframes: LIGHTING_KEYFRAMES });

describe("real-time town clock and lighting", () => {
  it("follows the town timezone's local wall-clock time, including DST", () => {
    // 2026-07-01 12:00 UTC is 05:00 PDT in Los Angeles (UTC-7) and 13:00 BST in London.
    expect(localHour(new Date("2026-07-01T12:00:00Z"), "America/Los_Angeles")).toBe(5);
    expect(localHour(new Date("2026-07-01T12:00:00Z"), "Europe/London")).toBe(13);
    // In winter LA is UTC-8: the same UTC instant is an hour earlier locally.
    expect(localHour(new Date("2026-12-01T12:00:00Z"), "America/Los_Angeles")).toBe(4);
    expect(at("2026-07-01T12:00:00Z", "Europe/London").phase).toBe("daytime");
    expect(at("2026-07-01T12:00:00Z", "Asia/Tokyo").phase).toBe("evening"); // 21:00 JST
  });

  it("names every phase of the day", () => {
    const phases = [3, 6, 9, 13, 18, 19.5, 21, 23].map(phaseForHour);
    expect(phases).toEqual(["night", "sunrise", "morning", "daytime", "golden", "sunset", "evening", "night"]);
  });

  it("changes gradually between keyframes (no jumps) and wraps around midnight", () => {
    let maxStep = 0;
    let prev = lightingAt(LIGHTING_KEYFRAMES, 0);
    for (let m = 1; m <= 24 * 60; m++) {
      const cur = lightingAt(LIGHTING_KEYFRAMES, m / 60);
      maxStep = Math.max(maxStep, Math.abs(cur.ambient.intensity - prev.ambient.intensity), Math.abs(cur.glow - prev.glow), Math.abs(cur.stars - prev.stars));
      prev = cur;
    }
    expect(maxStep).toBeLessThan(0.02); // per simulated minute
    expect(lightingAt(LIGHTING_KEYFRAMES, 23.99).stars).toBeCloseTo(lightingAt(LIGHTING_KEYFRAMES, 0).stars, 2);
  });

  it("lights up the night (lamps, windows, stars, fireflies) but keeps the town visible", () => {
    const night = lightingAt(LIGHTING_KEYFRAMES, 2);
    const noon = lightingAt(LIGHTING_KEYFRAMES, 12.5);
    expect(night.glow).toBe(1);
    expect(night.stars).toBe(1);
    expect(night.fireflies).toBe(1);
    expect(noon.glow).toBe(0);
    expect(noon.stars).toBe(0);
    expect(night.ambient.intensity + night.hemi.intensity).toBeGreaterThan(1); // never pitch black
    const sunrise = lightingAt(LIGHTING_KEYFRAMES, 6.1);
    expect(parseInt(sunrise.sun.color.slice(1, 3), 16)).toBeGreaterThan(parseInt(sunrise.sun.color.slice(5, 7), 16)); // warm (red > blue)
  });

  it("moves the sun east → west and uses a high moon at night", () => {
    expect(sunPosition(6)[0]).toBeGreaterThan(20);
    expect(sunPosition(19.5)[0]).toBeLessThan(-20);
    expect(sunPosition(12.75)[1]).toBeGreaterThan(30);
    expect(sunPosition(2)).toEqual([-14, 28, -20]);
  });

  it("lighting override changes the look only — the real clock is untouched", () => {
    const env = at("2026-07-01T12:00:00Z", "Europe/London", 23.5);
    expect(env.isOverride).toBe(true);
    expect(env.phase).toBe("night");
    expect(env.realHour).toBe(13);
    expect(env.weather.kind).toBe("clear");
    expect(at("2026-07-01T12:00:00Z", "Not/AZone").realHour).toBe(12); // falls back to UTC
    expect(lerpHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});
