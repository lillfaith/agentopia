import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "../server/llm/models.js";
import { computeTownTax, weekStartUtc } from "../server/engine/treasury.js";

describe("pricing", () => {
  const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 };
  it("prices Opus 5.5 at $4 / $20 per MTok plus cache and search", () => {
    expect(estimateCostUsd("claude-opus-5-5", { ...zero, inputTokens: 1_000_000 })).toBe(4);
    expect(estimateCostUsd("claude-opus-5-5", { ...zero, outputTokens: 1_000_000 })).toBe(20);
    expect(estimateCostUsd("claude-opus-5-5", { ...zero, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.2);
    expect(estimateCostUsd("claude-opus-5-5", { ...zero, webSearchRequests: 3 })).toBeCloseTo(0.03);
  });
  it("prices unknown models conservatively", () => {
    expect(estimateCostUsd("claude-mystery", { ...zero, inputTokens: 1_000_000 })).toBe(10);
  });
});

describe("town tax", () => {
  const base = { enabled: true, mode: "percent_of_cost" as const, rate: 5, weeklyCapUsd: 10, cause: "x" };
  it("is zero when disabled", () => {
    expect(computeTownTax({ ...base, enabled: false }, 100, 0).amount).toBe(0);
  });
  it("supports percent-of-cost and per-million-token modes with a cap", () => {
    expect(computeTownTax(base, 100, 0)).toEqual({ amount: 5, capped: false });
    expect(computeTownTax(base, 1000, 0)).toEqual({ amount: 10, capped: true });
    expect(computeTownTax({ ...base, mode: "per_million_tokens", rate: 0.5 }, 0, 4_000_000)).toEqual({ amount: 2, capped: false });
  });
  it("weeks start on Monday UTC", () => {
    expect(weekStartUtc(new Date("2026-10-08T12:00:00Z")).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(weekStartUtc(new Date("2026-10-05T00:00:00Z")).toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });
});
