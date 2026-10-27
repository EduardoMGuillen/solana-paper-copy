import { describe, expect, it } from "vitest";
import { DEFAULT_LIVE_PARAMS, PAPER_LIVE_PARAMS } from "./live-params";
import {
  binsBelow,
  liveCandidates,
  openLamports,
  planLiveLp,
  POSITION_RENT_LAMPORTS,
  positionRange,
  positionRentLamports,
  positionValue,
  solPerToken,
  type LiveCandidate,
  type PositionMark,
} from "./lp-plan";
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
      marks: { [pool]: { exists: true, valueLamports: 100_000_000, price: 0.001 } },
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
      marks: {},
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
      marks: {},
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
      marks: {},
      now: 2_000,
      pendingOpen: false,
    });
    expect(plan.open?.pool).toBe(pool);
    expect(plan.open?.range).toBe(0.74);
    expect(plan.open?.bins).toBe(69);
    expect(plan.notice).toMatch(/74%/);
  });

  it("places the full 75% on 1% pools when extended positions are allowed", () => {
    expect(positionRange(0.75, 100, 200)).toEqual({ range: 0.75, bins: 140 });
    expect(positionRange(0.75, 125, 200)).toEqual({ range: 0.75, bins: 112 });
    expect(positionRange(0.75, 200, 200)).toEqual({ range: 0.75, bins: 71 });
    expect(positionRange(0.75, 50, 200)).toBeNull();
    expect(binsBelow(0.75, 1, 5_000)).toBeNull();
    expect(positionRentLamports(69)).toBe(POSITION_RENT_LAMPORTS);
    expect(positionRentLamports(140)).toBe(POSITION_RENT_LAMPORTS + 70 * 600_000);
  });

  it("opens the 1% pool with more fees and reserves its larger rent", () => {
    const wide = { ...candidate(100), address: "95zNQQ8juGpu8odzpbp63ZNtXuTnnBeBsHovUjpe32d8", name: "RETAIL-SOL", fees24h: 9_000 };
    const input = {
      running: true,
      kill: false,
      balanceLamports: 400_000_000,
      reserveLamports: 30_000_000,
      maxSol: 0.3,
      params: { ...PAPER_LIVE_PARAMS, slot: 1 },
      positions: [],
      candidates: [wide, candidate(200)],
      marks: {},
      now: 2_000,
      pendingOpen: false,
      maxBins: 200,
    };
    const plan = planLiveLp(input);
    expect(plan.open?.name).toBe("RETAIL-SOL");
    expect(plan.open?.range).toBe(0.75);
    expect(plan.open?.bins).toBe(140);
    expect(plan.open?.lamports).toBe(400_000_000 - 30_000_000 - positionRentLamports(140) - 5_000_000);
    expect(planLiveLp({ ...input, maxBins: 69 }).open?.name).toBe("WEFT-SOL");
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
      marks: { [pool]: { exists: true, valueLamports: 95_000_000, price: 0.0007 } },
      now: 2_000,
      pendingOpen: false,
    });
    expect(plan.open).toBeNull();
    expect(plan.positions[0]?.closeReason).toBe("rug");
  });

  function markOne(mark: PositionMark | undefined, now = 2_000, extra: Partial<LivePosition> = {}) {
    return planLiveLp({
      running: true,
      kill: false,
      balanceLamports: 2_000_000_000,
      reserveLamports: 30_000_000,
      maxSol: 0.3,
      params: PAPER_LIVE_PARAMS,
      positions: [{ ...position(), ...extra }],
      candidates: [],
      marks: mark ? { [pool]: mark } : {},
      now,
      pendingOpen: false,
    }).positions[0];
  }

  it("takes profit on the on-chain value, fees included", () => {
    const marked = markOne({ exists: true, valueLamports: 108_500_000, price: 0.00099 });
    expect(marked?.closeReason).toBe("take-profit");
    expect(marked?.positionPct).toBeCloseTo(0.085);
    expect(marked?.tokenPct).toBeCloseTo(-0.01);
  });

  it("stops on the on-chain value", () => {
    const marked = markOne({ exists: true, valueLamports: 79_000_000, price: 0.00085 }, 2_000, { lastPrice: 0.0009 });
    expect(marked?.closeReason).toBe("loss");
  });

  it("keeps a position open without a read and fires only the time exit", () => {
    const unread = markOne(undefined);
    expect(unread?.closing).toBe(false);
    expect(unread?.note).toMatch(/Could not read/);
    const late = markOne(undefined, 1_000 + PAPER_LIVE_PARAMS.holdHours * 3_600_000);
    expect(late?.closeReason).toBe("time");
  });

  it("keeps a position open when the price runs up: no re-center churn", () => {
    for (const up of [0.0011, 0.0013, 0.002]) {
      const marked = markOne({ exists: true, valueLamports: 100_000_000, price: up }, 2_000, { lastPrice: up });
      expect(marked?.closing).toBe(false);
    }
  });

  it("skips pools younger than the minimum age, and pools of unknown age when an age is required", () => {
    const day = 86_400_000;
    const now = 30 * day;
    const young = { ...candidate(250), address: "95zNQQ8juGpu8odzpbp63ZNtXuTnnBeBsHovUjpe32d8", name: "YOUNG-SOL", fees24h: 9_000, createdAt: now - 3 * day };
    const unknown = { ...candidate(250), address: "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj", name: "UNKNOWN-SOL", fees24h: 8_000 };
    const old = { ...candidate(250), createdAt: now - 20 * day };
    const plan = (minAgeDays: number) =>
      planLiveLp({
        running: true,
        kill: false,
        balanceLamports: 2_000_000_000,
        reserveLamports: 30_000_000,
        maxSol: 0.3,
        params: { ...PAPER_LIVE_PARAMS, minAgeDays },
        positions: [],
        candidates: [young, unknown, old],
        marks: {},
        now,
        pendingOpen: false,
      });
    expect(plan(14).open?.name).toBe("WEFT-SOL");
    expect(plan(0).open?.name).toBe("YOUNG-SOL");
    expect(plan(60).open).toBeNull();
  });

  it("defaults to the recommended profile: 25% per position, Decoder screen and exits", () => {
    expect(DEFAULT_LIVE_PARAMS).toEqual({ ...PAPER_LIVE_PARAMS, slot: 0.25 });
  });

  it("does not re-center a position the price came back into", () => {
    const marked = markOne({ exists: true, valueLamports: 101_000_000, price: 0.0009 }, 2_000, { lastPrice: 0.0009 });
    expect(marked?.closing).toBe(false);
  });

  it("closes the record when the position account is gone", () => {
    expect(markOne({ exists: false, valueLamports: 0, price: 0 })?.closeReason).toBe("gone");
  });

  it("does not open a second pool of a token it already holds", () => {
    const other = { ...candidate(250), address: "HsG4A9hGVUAU2WQu2QtsY4acsuyoCJKKRHmy4a4YfuTm" };
    const plan = planLiveLp({
      running: true,
      kill: false,
      balanceLamports: 2_000_000_000,
      reserveLamports: 30_000_000,
      maxSol: 0.6,
      params: PAPER_LIVE_PARAMS,
      positions: [position()],
      candidates: [other],
      marks: {},
      now: 2_000,
      pendingOpen: false,
    });
    expect(plan.open).toBeNull();
  });

  it("does not open a pool that sits out after a failed open", () => {
    const plan = planLiveLp({
      running: true,
      kill: false,
      balanceLamports: 2_000_000_000,
      reserveLamports: 30_000_000,
      maxSol: 0.3,
      params: PAPER_LIVE_PARAMS,
      positions: [],
      candidates: [candidate(250)],
      marks: {},
      skipped: { [pool]: 5_000 },
      now: 2_000,
      pendingOpen: false,
    });
    expect(plan.open).toBeNull();
  });

  it("values a position in SOL from either side of the pair", () => {
    expect(solPerToken(0.002, true)).toBe(0.002);
    expect(solPerToken(500, false)).toBeCloseTo(0.002);
    expect(solPerToken(0, true)).toBe(0);
    // 0.05 SOL + 10 tokens (6 decimals) at 0.002 SOL + fees of 0.001 SOL and 1 token.
    const solY = positionValue({ solIsY: true, totalX: 10_000_000, totalY: 50_000_000, feeX: 1_000_000, feeY: 1_000_000, tokenDecimals: 6, solPerToken: 0.002 });
    expect(solY).toBe(51_000_000 + 22_000_000);
    const solX = positionValue({ solIsY: false, totalX: 50_000_000, totalY: 10_000_000, feeX: 0, feeY: 0, tokenDecimals: 6, solPerToken: 0.002 });
    expect(solX).toBe(50_000_000 + 20_000_000);
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
