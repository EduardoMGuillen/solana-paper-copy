import { describe, expect, it } from "vitest";
import { bidAskBins, bidAskValue, DECODER_SHAPE } from "./bidask";
import { DECODER_EXITS, DECODER_RULES, forwardTest, parsePairs, simulateLp, toSnap, WSOL, type PoolSnap } from "./meteora";

const bins = bidAskBins(DECODER_SHAPE);

describe("bid-ask math", () => {
  it("is untouched above entry and loses little until -50%", () => {
    expect(bidAskValue(bins, 1.2)).toBeCloseTo(1);
    expect(bidAskValue(bins, 0.5)).toBeGreaterThan(0.94);
    expect(bidAskValue(bins, 0.5)).toBeLessThan(0.96);
  });

  it("loses heavily once the token crashes through the range", () => {
    expect(bidAskValue(bins, 0.25)).toBeLessThan(0.7);
    expect(bidAskValue(bins, 0.05)).toBeLessThan(0.15);
  });
});

describe("meteora parsing", () => {
  const pair = {
    address: "Pool111",
    name: "MEME-SOL",
    mint_x: "Meme111",
    mint_y: WSOL,
    bin_step: 100,
    base_fee_percentage: "2",
    liquidity: "50000",
    current_price: 0.0001,
    fees_24h: 6000,
    trade_volume_24h: 300000,
    fees: { hour_1: 250 },
    volume: { hour_1: 12000 },
  };

  it("accepts the documented array shape and wrapped shapes", () => {
    expect(parsePairs([pair])).toHaveLength(1);
    expect(parsePairs({ pairs: [pair] })).toHaveLength(1);
    expect(parsePairs({ nope: 1 })).toHaveLength(0);
  });

  it("normalizes price to SOL per token and drops non-SOL or hidden pools", () => {
    expect(toSnap(pair, 0)?.price).toBe(0.0001);
    expect(toSnap({ ...pair, mint_x: WSOL, mint_y: "Meme111", current_price: 10_000 }, 0)?.price).toBeCloseTo(0.0001);
    expect(toSnap({ ...pair, mint_y: "USDC111" }, 0)).toBeNull();
    expect(toSnap({ ...pair, is_blacklisted: true }, 0)).toBeNull();
  });
});

function path(prices: number[], fees1h = 250): PoolSnap[] {
  return prices.map((price, i) => ({
    t: i * 3_600_000,
    address: "Pool111",
    name: "MEME-SOL",
    price,
    tvl: 50_000,
    binStep: 100,
    baseFeePct: 2,
    fees1h,
    fees24h: 6_000,
    volume1h: 12_000,
    volume24h: 300_000,
  }));
}

describe("forward test", () => {
  it("earns fees while the price chops inside the range", () => {
    const trade = simulateLp(path([1, 0.9, 0.95, 0.9, 0.95, 0.9, 0.95, 0.9, 0.95, 0.9, 0.95, 0.9, 0.95, 0.9, 0.95, 0.9, 0.95, 0.92]), 0, DECODER_SHAPE, DECODER_EXITS);
    expect(trade?.reason).toBe("take-profit");
    expect(trade!.result).toBeGreaterThan(0);
  });

  it("takes a large loss on a rug", () => {
    const trade = simulateLp(path([1, 0.7, 0.4, 0.15]), 0, DECODER_SHAPE, { ...DECODER_EXITS, stopLoss: 0.9 });
    expect(trade?.reason).toBe("fuera de rango");
    expect(trade!.result).toBeLessThan(-0.4);
  });

  it("opens at most one position per pool at a time and reports crash rate", () => {
    const r = forwardTest(path([1, 0.7, 0.4, 0.15, 0.15]), DECODER_RULES, DECODER_SHAPE, { ...DECODER_EXITS, stopLoss: 0.9 });
    expect(r.trades.length).toBeGreaterThanOrEqual(1);
    expect(r.crashRate).toBeGreaterThan(0);
  });
});
