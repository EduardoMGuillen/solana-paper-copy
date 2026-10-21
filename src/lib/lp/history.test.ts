import { describe, expect, it } from "vitest";
import { parseCandles, parseVolumes } from "./datapi";
import { assembleReport, historySnaps, keepOnePoolPerName, type PoolMeta } from "./history";

const meta: PoolMeta = {
  address: "Pool111",
  name: "MEME-SOL",
  solIsY: true,
  tvl: 50_000,
  binStep: 100,
  baseFeePct: 2,
};

describe("daily history snaps", () => {
  it("joins candles to fee buckets and spreads a day's fees over 24 hours", () => {
    const day = 1_700_000_000;
    const snaps = historySnaps(
      meta,
      [
        { timestamp: day, close: 0.001 },
        { timestamp: day + 86_400, close: 0.0009 },
      ],
      [
        { timestamp: day, volume: 240_000, fees: 2_400 },
        { timestamp: day + 86_400, volume: 0, fees: 0 },
      ],
    );
    expect(snaps).toHaveLength(2);
    expect(snaps[0].fees1h).toBe(100);
    expect(snaps[0].fees24h).toBe(2_400);
    expect(snaps[0].volume1h).toBe(10_000);
    expect(snaps[0].t).toBe(day * 1000);
    expect(snaps[0].tvl).toBe(50_000);
  });

  it("inverts the close when SOL is the base mint and drops a candle without fees", () => {
    const snaps = historySnaps(
      { ...meta, solIsY: false },
      [
        { timestamp: 86_400, close: 10_000 },
        { timestamp: 172_800, close: 5_000 },
      ],
      [{ timestamp: 90_000, volume: 24_000, fees: 240 }],
    );
    expect(snaps).toHaveLength(1);
    expect(snaps[0].price).toBeCloseTo(0.0001);
  });
});

describe("report assembly", () => {
  it("publishes the Decoder scenario and a cumulative sum that is not a portfolio", () => {
    const start = Date.UTC(2026, 0, 1) / 1000;
    const candles = [1, 0.9, 0.95, 0.9].map((close, i) => ({ timestamp: start + i * 86_400, close }));
    const volumes = candles.map((candle) => ({ timestamp: candle.timestamp, volume: 300_000, fees: 6_000 }));
    const snaps = historySnaps(meta, candles, volumes);
    const view = assembleReport({ now: 1, windowDays: 90, poolsSeen: 1, poolsWithHistory: 1, failed: 0, snaps });
    const decoder = view.scenarios.find((scenario) => scenario.id === "decoder");
    expect(decoder?.trades).toBe(view.trades.length);
    expect(decoder!.trades).toBeGreaterThan(0);
    expect(view.curve.at(-1)?.sum).toBeCloseTo(decoder!.sum);
    expect(view.pools[0].address).toBe("Pool111");
  });

  it("counts one pool when two addresses share a name", () => {
    const start = Date.UTC(2026, 0, 1) / 1000;
    const candles = [1, 0.9, 0.95].map((close, i) => ({ timestamp: start + i * 86_400, close }));
    const rich = candles.map((candle) => ({ timestamp: candle.timestamp, volume: 300_000, fees: 12_000 }));
    const poor = candles.map((candle) => ({ timestamp: candle.timestamp, volume: 300_000, fees: 2_000 }));
    const snaps = [
      ...historySnaps({ ...meta, address: "rich", name: "WEFT-SOL" }, candles, rich),
      ...historySnaps({ ...meta, address: "poor", name: "WEFT-SOL" }, candles, poor),
      ...historySnaps({ ...meta, address: "other", name: "POKE-SOL" }, candles, poor),
    ];
    expect([...new Set(keepOnePoolPerName(snaps).map((snap) => snap.address))].sort()).toEqual(["other", "rich"]);
    const view = assembleReport({ now: 1, windowDays: 90, poolsSeen: 3, poolsWithHistory: 3, failed: 0, snaps });
    expect(view.pools.every((pool) => pool.address !== "poor")).toBe(true);
    expect(view.trades.every((trade) => trade.address !== "poor")).toBe(true);
  });
});

describe("Data API parsers", () => {
  it("keeps finite candles and fee buckets and drops junk", () => {
    expect(parseCandles({ data: [{ timestamp: 10, close: 1.5 }, { timestamp: 0, close: 1 }] })).toEqual([{ timestamp: 10, close: 1.5 }]);
    expect(parseVolumes({ data: [{ timestamp: 10, volume: 0, fees: 3 }] })).toEqual([{ timestamp: 10, volume: 0, fees: 3 }]);
    expect(parseCandles({ nope: true })).toEqual([]);
  });
});