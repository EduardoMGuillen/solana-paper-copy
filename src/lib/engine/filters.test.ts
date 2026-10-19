import { describe, expect, it } from "vitest";
import { evaluateCopy, type FilterInput } from "./filters";
import { defaultSettings } from "./settings";
import type { LeaderFill, Position } from "./types";

function fill(patch: Partial<LeaderFill> = {}): LeaderFill {
  return {
    leaderId: "lumen",
    mint: "Mint11111111111111111111111111111111111111",
    symbol: "TOK",
    side: "buy",
    leaderQtyBefore: 0,
    leaderQtyAfter: 10_000,
    fillPriceSol: 0.01,
    fillTime: 5_000,
    observedAt: 5_000,
    currentPriceSol: 0.01,
    leaderNotionalSol: 800,
    ...patch,
  };
}

function gate(patch: Partial<FilterInput> = {}): FilterInput {
  return {
    equitySol: 10,
    cashSol: 10,
    settings: { ...defaultSettings, blocklist: [] },
    leader: { id: "lumen", enabled: true, equity: 100, peakEquity: 100 },
    positions: [],
    mintLastEntry: {},
    killActive: false,
    fill: fill(),
    ...patch,
  };
}

describe("copy filter pipeline", () => {
  it("accepts a fresh entry and sizes it from our equity", () => {
    const decision = evaluateCopy(gate());
    expect(decision.ok).toBe(true);
    if (decision.ok && decision.action === "buy") {
      expect(decision.sizeSol).toBeCloseTo(0.2);
      expect(decision.sizeSol).toBeLessThan(1);
    }
  });

  it("collects every independent failure", () => {
    const decision = evaluateCopy(
      gate({
        fill: fill({
          mint: "BlockedMint1111111111111111111111111111111",
          fillTime: 0,
          observedAt: 60_000,
          currentPriceSol: 0.02,
        }),
        settings: {
          ...defaultSettings,
          blocklist: ["BlockedMint1111111111111111111111111111111"],
          maxSignalAgeMs: 10_000,
          maxPriceDriftBps: 100,
        },
      }),
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reasons).toEqual(
        expect.arrayContaining(["blocklist", "stale_age", "price_drift"]),
      );
    }
  });

  it("blocks observation, the kill switch, pause, cooldown, and dust", () => {
    expect(evaluateCopy(gate({ leader: { id: "lumen", enabled: false, equity: 100, peakEquity: 100 } })).ok).toBe(false);
    const killed = evaluateCopy(gate({ killActive: true }));
    expect(killed.ok).toBe(false);
    if (!killed.ok) expect(killed.reasons).toContain("kill_switch");

    const paused = evaluateCopy(
      gate({ leader: { id: "lumen", enabled: true, equity: 70, peakEquity: 100 } }),
    );
    expect(paused.ok).toBe(false);
    if (!paused.ok) expect(paused.reasons).toContain("leader_paused");

    const cooled = evaluateCopy(gate({ mintLastEntry: { [fill().mint]: 4_000 } }));
    expect(cooled.ok).toBe(false);
    if (!cooled.ok) expect(cooled.reasons).toContain("cooldown");

    const dusty = evaluateCopy(gate({ settings: { ...defaultSettings, minSol: 1, blocklist: [] } }));
    expect(dusty.ok).toBe(false);
    if (!dusty.ok) expect(dusty.reasons).toContain("dust");
  });

  it("still mirrors an exit while the kill switch is on", () => {
    const position: Position = {
      id: "pos-1",
      leaderId: "lumen",
      mint: fill().mint,
      symbol: "TOK",
      qty: 40,
      costSol: 0.2,
      entryPrice: 0.01,
      openedAt: 1,
      stopPrice: 0.008,
    };
    const decision = evaluateCopy(
      gate({
        killActive: true,
        positions: [position],
        fill: fill({
          side: "sell",
          leaderQtyBefore: 100,
          leaderQtyAfter: 50,
          leaderNotionalSol: 0.5,
        }),
      }),
    );
    expect(decision.ok).toBe(true);
    if (decision.ok && decision.action === "sell") {
      expect(decision.sellFraction).toBeCloseTo(0.5);
      expect(decision.qty).toBeCloseTo(20);
    }
  });

  it("skips a dusty partial but allows a full leader exit", () => {
    const position: Position = {
      id: "pos-1",
      leaderId: "lumen",
      mint: fill().mint,
      symbol: "TOK",
      qty: 4,
      costSol: 0.04,
      entryPrice: 0.01,
      openedAt: 1,
      stopPrice: 0.008,
    };
    const partial = evaluateCopy(
      gate({
        positions: [position],
        settings: { ...defaultSettings, minSol: 0.05, blocklist: [] },
        fill: fill({ side: "sell", leaderQtyBefore: 100, leaderQtyAfter: 50 }),
      }),
    );
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.reasons).toContain("dust");

    const full = evaluateCopy(
      gate({
        positions: [position],
        settings: { ...defaultSettings, minSol: 0.05, blocklist: [] },
        fill: fill({ side: "sell", leaderQtyBefore: 100, leaderQtyAfter: 0 }),
      }),
    );
    expect(full.ok).toBe(true);
  });
});
