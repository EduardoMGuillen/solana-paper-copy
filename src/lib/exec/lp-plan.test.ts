import { describe, expect, it } from "vitest";
import { PAPER_LIVE_PARAMS } from "./live-params";
import { binsBelow, liveCandidates, openLamports, planLiveLp, positionRange, type LiveCandidate } from "./lp-plan";
import type { LivePosition } from "./live-book";

const pool = "EQEu6NyEq8nECAiem1YkTu3uDBiGTEA2tYBLBmr9YJ7Y";
const token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function candidate(binStep: number, fees24h = 2_000): LiveCandidate {
  return {
    t: 1,
    address: pool,
    name: "WEFT-SOL",
    price: 0.001,
    tvl: 20_000,
    binStep,
    baseFeePct: 2,
    fees1h: 100,
    fees24h,
    volume1h: 20_000,
    volume24h: 40_000,
    solIsY: true,
    tokenMint: token,
  };
}

function position(): LivePosition {
  return {
    address: pool,
    name: "WEFT-SOL",
    stakeSol: 0.1,
    openedAt: 1_000,
    signature: "sig",
    position: "Pos111111111111111111111111111111111111111",
    minBinId: 1,
    maxBinId: 57,
    solIsY: true,
    tokenMint: token,
    entryPrice: 0.001,
    lastPrice: 0.001,
    range: 0.75,
    binStepBps: 250,
    closing: false,
    closeReason: null,
    tokenPct: null,
    positionPct: null,
    note: "",
  };
}

describe("live open plan", () => {
  it("keeps a 75% range only when it fits one position", () => {
    expect(binsBelow(0.75, 100)).toBeNull();
    expect(binsBelow(0.75, 250)).toBe(57);
    expect(positionRange(0.75, 250)).toEqual({ range: 0.75, bins: 57 });
    expect(positionRange(0.75, 200)).toEqual({ range: 0.74, bins: 69 });
    expect(positionRange(0.75, 100)).toBeNull();
    expect(positionRange(0.75, 125)).toBeNull();
  });

  it("uses a slice of the wallet and leaves the reserve", () => {
    const lamports = openLamports({
      balanceLamports: 141_477_424,
      reserveLamports: 30_000_000,
      rentLamports: 60_000_000,
      feeLamports: 5_000_000,
      maxLamports: 300_000_000,
      openStakeLamports: 0,
      slot: 0.1,
    });
    expect(lamports).toBe(14_147_742);
    expect(openLamports({
      balanceLamports: 50_000_000,
      reserveLamports: 30_000_000,
      rentLamports: 60_000_000,
      feeLamports: 5_000_000,
      maxLamports: 300_000_000,
      openStakeLamports: 0,
      slot: 0.1,
    })).toBe(0);
  });

  it("does not open while a kill switch is on, and closes what is open", () => {
    const plan = planLiveLp({
      running: true,
      kill: true,
      balanceLamports: 2_000_000_000,
      reserveLamports: 30_000_000,
      maxSol: 0.3,
      params: PAPER_LIVE_PARAMS,
      positions: [position()],
      candidates: [candidate(250)],
      prices: { [pool]: 0.001 },
      now: 2_000,
      pendingOpen: false,
    });
    expect(plan.open).toBeNull();
    expect(plan.positions[0]?.closing).toBe(true);
    expect(plan.positions[0]?.closeReason).toBe("stop");
  });

  it("opens the pool that fits and can open it again after it is closed", () => {
    const wide = { ...candidate(100), address: "95zNQQ8juGpu8odzpbp63ZNtXuTnnBeBsHovUjpe32d8", name: "WIDE-SOL", fees24h: 9_000 };
    const plan = planLiveLp({
      running: true,
      kill: false,
      balanceLamports: 2_000_000_000,
      reserveLamports: 30_000_000,
      maxSol: 0.3,
      params: PAPER_LIVE_PARAMS,
      positions: [],
      candidates: [wide, candidate(250)],
      prices: {},
      now: 2_000,
      pendingOpen: false,
    });
    expect(plan.open?.pool).toBe(pool);
    expect(plan.open?.lamports).toBe(200_000_000);
    const again = planLiveLp({
      running: true,
      kill: false,
      balanceLamports: 2_000_000_000,
      reserveLamports: 30_000_000,
      maxSol: 0.3,
      params: PAPER_LIVE_PARAMS,
      positions: [],
      candidates: [candidate(250)],
      prices: {},
      now: 2_000,
      pendingOpen: false,
    });
    expect(again.open?.pool).toBe(pool);
  });

  it("opens a 2% pool at 74% and still refuses a 1% pool", () => {
    const narrow = { ...candidate(100), address: "95zNQQ8juGpu8odzpbp63ZNtXuTnnBeBsHovUjpe32d8", name: "BORDR-SOL", fees24h: 9_000 };
    const twoPercent = { ...candidate(200), name: "pill-SOL" };
    const plan = planLiveLp({
      running: true,
      kill: false,
      balanceLamports: 400_000_000,
      reserveLamports: 30_000_000,
      maxSol: 0.3,
      params: PAPER_LIVE_PARAMS,
      positions: [],
      candidates: [narrow, twoPercent],
      prices: {},
      now: 2_000,
      pendingOpen: false,
    });
    expect(plan.open?.pool).toBe(pool);
    expect(plan.open?.range).toBe(0.74);
    expect(plan.open?.bins).toBe(69);
    expect(plan.notice).toMatch(/74%/);
  });

  it("closes on a sudden drop", () => {
    const open = position();
    const plan = planLiveLp({
      running: true,
      kill: false,
      balanceLamports: 2_000_000_000,
      reserveLamports: 30_000_000,
      maxSol: 0.3,
      params: PAPER_LIVE_PARAMS,
      positions: [open],
      candidates: [candidate(250)],
      prices: { [pool]: 0.0007 },
      now: 2_000,
      pendingOpen: false,
    });
    expect(plan.open).toBeNull();
    expect(plan.positions[0]?.closeReason).toBe("rug");
  });

  it("reads which side is SOL from the pair", () => {
    const rows = liveCandidates(
      [{ address: pool, name: "WEFT-SOL", mint_x: token, mint_y: "So11111111111111111111111111111111111111112", current_price: 0.001, liquidity: 20_000, bin_step: 250, base_fee_percentage: 2, fees: { hour_1: 100, hour_24: 2_000 }, volume: { hour_1: 20_000, hour_24: 40_000 } }],
      1,
    );
    expect(rows[0]?.solIsY).toBe(true);
    expect(rows[0]?.tokenMint).toBe(token);
  });
});
