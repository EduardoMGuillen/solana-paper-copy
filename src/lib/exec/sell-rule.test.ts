import { describe, expect, it } from "vitest";
import { decideSell, impactTooHigh } from "./sell-rule";

describe("sell leftover token", () => {
  it("treats the DLMM impact as a percent against the bps cap", () => {
    expect(impactTooHigh(1.5, 150)).toBe(false);
    expect(impactTooHigh(1.51, 150)).toBe(true);
    expect(impactTooHigh(Number.NaN, 150)).toBe(true);
  });

  it("sells a real amount, and keeps dust or a bad route", () => {
    expect(decideSell({ rawAmount: BigInt(0), outLamports: BigInt(5_000_000), priceImpactPercent: 0.2, maxImpactBps: 150 })).toEqual({ sell: false, reason: "none" });
    expect(decideSell({ rawAmount: BigInt(1_000), outLamports: BigInt(5_000_000), priceImpactPercent: 0.4, maxImpactBps: 150 })).toEqual({ sell: true });
    expect(decideSell({ rawAmount: BigInt(1_000), outLamports: BigInt(100), priceImpactPercent: 0.1, maxImpactBps: 150 }).sell).toBe(false);
    const blocked = decideSell({ rawAmount: BigInt(1_000), outLamports: BigInt(5_000_000), priceImpactPercent: 3, maxImpactBps: 150 });
    expect(blocked.sell).toBe(false);
    if (!blocked.sell) expect(blocked.reason).toMatch(/impact cap/);
  });
});
