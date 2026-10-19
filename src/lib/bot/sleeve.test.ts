import { describe, expect, it } from "vitest";
import type { Candle } from "./indicators";
import { fillAtOpen, newSleeve, sleeveEquity, stepBar, stopAtPrice } from "./sleeve";
import { computeIndicators, type Strategy } from "./strategies";

const costs = { feeBps: 10, slippageBps: 10 };
const sizing = { riskPerTrade: 0.02, maxExposure: 1 };

/** Buys on bar 1's close with a stop 10 below; never exits by signal. */
const once: Strategy = {
  id: "cruce",
  name: "test",
  summary: "",
  warmup: 1,
  entry: (ind, i) => (i === 1 ? { stop: ind.close[i] - 10, note: "test" } : null),
  manage: (_ind, _i, trade) => ({ exit: false, stop: trade.stop }),
};

function bar(t: number, o: number, h: number, l: number, c: number): Candle {
  return { t, o, h, l, c, v: 1 };
}

describe("sleeve", () => {
  it("fills at the NEXT bar's open, never at the signal bar's close", () => {
    const candles = [bar(0, 100, 101, 99, 100), bar(1, 100, 101, 99, 100), bar(2, 104, 105, 103, 104)];
    const ind = computeIndicators(candles);
    const sleeve = newSleeve(1000);
    stepBar(sleeve, once, ind, 1, costs, sizing);
    expect(sleeve.position).toBeNull();
    expect(sleeve.pending?.kind).toBe("buy");
    stepBar(sleeve, once, ind, 2, costs, sizing);
    expect(sleeve.position?.entryPrice).toBeCloseTo(104 * 1.001);
  });

  it("sizes by risk: a stop-out loses about riskPerTrade of the sleeve", () => {
    const candles = [bar(0, 100, 101, 99, 100), bar(1, 100, 101, 99, 100), bar(2, 100, 100, 100, 100), bar(3, 95, 96, 80, 85)];
    const ind = computeIndicators(candles);
    const sleeve = newSleeve(1000);
    for (let i = 1; i < candles.length; i += 1) stepBar(sleeve, once, ind, i, costs, sizing);
    expect(sleeve.trades).toHaveLength(1);
    const trade = sleeve.trades[0];
    expect(trade.reason).toBe("stop");
    expect(trade.exitPrice).toBeCloseTo(90 * 0.999);
    expect(trade.pnl / 1000).toBeGreaterThan(-0.025);
    expect(trade.pnl / 1000).toBeLessThan(-0.019);
    expect(trade.r).toBeCloseTo(-1, 0);
  });

  it("a gap through the stop fills at the open, not at the stop", () => {
    const candles = [bar(0, 100, 101, 99, 100), bar(1, 100, 101, 99, 100), bar(2, 100, 100, 100, 100), bar(3, 70, 72, 65, 70)];
    const ind = computeIndicators(candles);
    const sleeve = newSleeve(1000);
    for (let i = 1; i < candles.length; i += 1) stepBar(sleeve, once, ind, i, costs, sizing);
    expect(sleeve.trades[0].exitPrice).toBeCloseTo(70 * 0.999);
  });

  it("never spends more than the sleeve holds", () => {
    const tight: Strategy = { ...once, entry: (ind, i) => (i === 1 ? { stop: ind.close[i] - 0.01, note: "" } : null) };
    const candles = [bar(0, 100, 101, 99, 100), bar(1, 100, 101, 99, 100), bar(2, 100, 100, 100, 100)];
    const sleeve = newSleeve(1000);
    const ind = computeIndicators(candles);
    for (let i = 1; i < candles.length; i += 1) stepBar(sleeve, tight, ind, i, costs, sizing);
    expect(sleeve.cash).toBeGreaterThanOrEqual(0);
    expect(sleeveEquity(sleeve, 100, costs)).toBeLessThan(1000);
    expect(sleeveEquity(sleeve, 100, costs)).toBeGreaterThan(995);
  });

  it("blocks entries when halted", () => {
    const sleeve = newSleeve(1000);
    sleeve.pending = { kind: "buy", stop: 90, note: "", decidedT: 0 };
    expect(fillAtOpen(sleeve, bar(1, 100, 100, 100, 100), costs, sizing, false)).toEqual([]);
    expect(sleeve.position).toBeNull();
  });

  it("stops out on a live price inside the forming bar", () => {
    const sleeve = newSleeve(1000);
    sleeve.pending = { kind: "buy", stop: 90, note: "", decidedT: 0 };
    fillAtOpen(sleeve, bar(1, 100, 100, 100, 100), costs, sizing, true);
    expect(stopAtPrice(sleeve, 95, 2, costs)).toBeNull();
    expect(stopAtPrice(sleeve, 89, 2, costs)?.reason).toBe("stop");
    expect(sleeve.position).toBeNull();
  });
});
