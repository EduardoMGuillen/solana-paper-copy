import { describe, expect, it } from "vitest";
import { clampLiveParams, DEFAULT_LIVE_PARAMS, LIVE_PRESETS, sameLiveParams } from "./live-params";

describe("live params", () => {
  it("starts on the recommended preset", () => {
    expect(LIVE_PRESETS[0].id).toBe("recomendado");
    expect(sameLiveParams(LIVE_PRESETS[0].params, DEFAULT_LIVE_PARAMS)).toBe(true);
    expect(clampLiveParams(null)).toEqual(DEFAULT_LIVE_PARAMS);
  });

  it("keeps the pool age inside 0-90 days and whole", () => {
    expect(clampLiveParams({ minAgeDays: -3 }).minAgeDays).toBe(0);
    expect(clampLiveParams({ minAgeDays: 400 }).minAgeDays).toBe(90);
    expect(clampLiveParams({ minAgeDays: 13.6 }).minAgeDays).toBe(14);
  });

  it("has a conservative preset that only takes mature pools", () => {
    const conservative = LIVE_PRESETS.find((preset) => preset.id === "conservador")!.params;
    expect(conservative.minAgeDays).toBeGreaterThanOrEqual(14);
    expect(conservative.minTvl).toBeGreaterThanOrEqual(50_000);
  });
});
