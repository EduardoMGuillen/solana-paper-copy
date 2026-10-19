import { describe, expect, it } from "vitest";
import { createSeededState } from "./demo";
import {
  applyFill,
  applyMeteoraRoster,
  applyProtectiveStops,
  createInitialState,
  setKill,
} from "./engine";
import type { MeteoraWallet } from "./types";

describe("paper engine", () => {
  it("copies half of our tokens when the leader sells half, not the leader size", () => {
    const state = createInitialState(1_000_000);
    state.settings.slippageBps = 0;
    state.settings.feeBps = 0;
    const leader = state.leaders[0];
    applyFill(state, {
      leaderId: leader.id,
      mint: "PaperAURA111111111111111111111111111111111",
      symbol: "AURA",
      side: "buy",
      leaderQtyBefore: 0,
      leaderQtyAfter: 50_000,
      fillPriceSol: 0.004,
      fillTime: 1_000_000,
      observedAt: 1_000_000,
      currentPriceSol: 0.004,
      leaderNotionalSol: 200,
    });
    const opened = state.positions.find((position) => position.leaderId === leader.id);
    expect(opened).toBeTruthy();
    const openedQty = opened?.qty ?? 0;
    const bought = state.trades.find((trade) => trade.side === "buy");
    expect(bought?.notionalSol).toBeCloseTo(0.2);
    expect(bought?.notionalSol).not.toBeCloseTo(200);
    applyFill(state, {
      leaderId: leader.id,
      mint: "PaperAURA111111111111111111111111111111111",
      symbol: "AURA",
      side: "sell",
      leaderQtyBefore: 50_000,
      leaderQtyAfter: 25_000,
      fillPriceSol: 0.004,
      fillTime: 1_010_000,
      observedAt: 1_010_000,
      currentPriceSol: 0.004,
      leaderNotionalSol: 100,
    });
    const left = state.positions.find((position) => position.leaderId === leader.id);
    expect(left?.qty).toBeCloseTo(openedQty / 2);
  });

  it("fires the protective stop even when new copies are killed", () => {
    const state = createInitialState(2_000_000);
    state.settings.slippageBps = 0;
    state.settings.feeBps = 0;
    const leader = state.leaders[0];
    applyFill(state, {
      leaderId: leader.id,
      mint: "PaperAURA111111111111111111111111111111111",
      symbol: "AURA",
      side: "buy",
      leaderQtyBefore: 0,
      leaderQtyAfter: 100,
      fillPriceSol: 1,
      fillTime: 2_000_000,
      observedAt: 2_000_000,
      currentPriceSol: 1,
      leaderNotionalSol: 100,
    });
    setKill(state, true, 2_000_100);
    state.prices["PaperAURA111111111111111111111111111111111"] = 0.5;
    applyProtectiveStops(state, 2_000_200);
    expect(state.positions).toHaveLength(0);
    expect(state.trades.some((trade) => trade.reason === "stop")).toBe(true);
  });

  it("keeps new Meteora wallets in observation until enabled", () => {
    const state = createInitialState(3_000_000);
    const roster: MeteoraWallet[] = Array.from({ length: 7 }, (_, index) => ({
      rank: index + 1,
      address: `Wallet${index}111111111111111111111111111111111`.slice(0, 44),
      stakedAmount: 1000 - index,
      rewardUsd: index,
    }));
    applyMeteoraRoster(state, roster, {
      vaultLabel: "NATION/SOL",
      vaultAddress: "vault",
      refreshedAt: 3_000_000,
    });
    const listed = state.leaders.filter((leader) => leader.kind === "meteora" && leader.listed);
    expect(listed).toHaveLength(7);
    expect(listed.every((leader) => leader.enabled === false)).toBe(true);
    listed[0].enabled = true;
    const kept = listed[0].wallet!;
    applyMeteoraRoster(
      state,
      roster.slice(1),
      { vaultLabel: "NATION/SOL", vaultAddress: "vault", refreshedAt: 3_100_000 },
    );
    const survivor = state.leaders.find((leader) => leader.wallet === kept);
    expect(survivor?.enabled).toBe(true);
    expect(survivor?.listed).toBe(false);
  });

  it("seeds a moving paper book without tripping the kill switch", () => {
    const state = createSeededState(1_700_000_000_000);
    const buys = state.trades.filter((trade) => trade.side === "buy");
    expect(buys.length).toBeGreaterThan(0);
    expect(Math.max(...buys.map((trade) => trade.notionalSol))).toBeLessThan(1);
    expect(state.leaders.find((leader) => leader.id === "lumen")?.stats.wins).toBeGreaterThan(0);
    expect(state.leaders.find((leader) => leader.id === "fosa")?.stats.maxDrawdown).toBeGreaterThan(0.05);
    expect(state.kill.auto).toBe(false);
    expect(state.equityCurve.length).toBeGreaterThan(10);
    expect(state.series.lumen?.length).toBeGreaterThan(5);
  });
});
