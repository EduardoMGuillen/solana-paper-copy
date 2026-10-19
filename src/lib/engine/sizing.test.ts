import { describe, expect, it } from "vitest";
import { sizeEntrySol } from "./sizing";

const base = {
  equitySol: 10,
  cashSol: 10,
  fraction: 0.02,
  fractionCap: 0.05,
  drawdown: 0,
  pauseDrawdown: 0.25,
  leaderUsedSol: 0,
  leaderCapSol: 3,
  minSol: 0.05,
  feeBps: 0,
  leaderNotionalSol: 999,
};

describe("fixed-fraction sizing", () => {
  it("sizes off our equity and ignores the leader notional", () => {
    const sized = sizeEntrySol(base);
    expect(sized.ok).toBe(true);
    if (sized.ok) expect(sized.sizeSol).toBeCloseTo(0.2);
  });

  it("caps the fraction", () => {
    const sized = sizeEntrySol({ ...base, fraction: 0.2, fractionCap: 0.05 });
    expect(sized.ok).toBe(true);
    if (sized.ok) expect(sized.sizeSol).toBeCloseTo(0.5);
  });

  it("shrinks as the leader drawdown grows", () => {
    const sized = sizeEntrySol({ ...base, drawdown: 0.125, pauseDrawdown: 0.25 });
    expect(sized.ok).toBe(true);
    if (sized.ok) {
      expect(sized.shrink).toBeCloseTo(0.5);
      expect(sized.sizeSol).toBeCloseTo(0.1);
    }
  });

  it("stops at the per-leader capital cap", () => {
    const sized = sizeEntrySol({ ...base, leaderUsedSol: 2.9, leaderCapSol: 3 });
    expect(sized.ok).toBe(true);
    if (sized.ok) expect(sized.sizeSol).toBeCloseTo(0.1);
  });

  it("rejects a full leader cap and dust leftovers", () => {
    expect(sizeEntrySol({ ...base, leaderUsedSol: 3 }).ok).toBe(false);
    const dust = sizeEntrySol({ ...base, minSol: 0.5 });
    expect(dust.ok).toBe(false);
    if (!dust.ok) expect(dust.reason).toBe("dust");
  });

  it("rejects entries once drawdown reaches the pause", () => {
    const paused = sizeEntrySol({ ...base, drawdown: 0.25, pauseDrawdown: 0.25 });
    expect(paused.ok).toBe(false);
    if (!paused.ok) expect(paused.reason).toBe("drawdown_pause");
  });
});
