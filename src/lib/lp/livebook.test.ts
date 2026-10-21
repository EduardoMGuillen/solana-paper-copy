import { describe, expect, it } from "vitest";
import { dueLiveFetch } from "./forward";
import { runMeteoraBook } from "./livebook";
import type { PoolSnap } from "./meteora";

function snap(partial: Partial<PoolSnap> & Pick<PoolSnap, "t" | "address" | "price">): PoolSnap {
  return {
    name: partial.address,
    tvl: 50_000,
    binStep: 100,
    baseFeePct: 2,
    fees1h: 250,
    fees24h: 6_000,
    volume1h: 12_000,
    volume24h: 300_000,
    ...partial,
  };
}

describe("live refresh", () => {
  it("reprices an open pool every cycle and scans the list only when flat", () => {
    expect(dueLiveFetch(null, false, 0)).toBe("scan");
    const state = { lastFetchAt: 0, lastScanAt: 0 };
    expect(dueLiveFetch(state, true, 11_000)).toBeNull();
    expect(dueLiveFetch(state, true, 12_000)).toBe("mark");
    expect(dueLiveFetch(state, false, 12_000)).toBeNull();
    expect(dueLiveFetch(state, false, 60_000)).toBe("scan");
  });

  it("scans while positions are open once a 25% slot is free", () => {
    const state = { lastFetchAt: 0, lastScanAt: 0 };
    expect(dueLiveFetch(state, true, 12_000, true)).toBe("mark");
    expect(dueLiveFetch(state, true, 60_000, true)).toBe("scan");
    expect(dueLiveFetch(state, true, 60_000, false)).toBe("mark");
  });
});

describe("meteora live book", () => {
  it("stays flat when the token rises above the entry and reports that rise", () => {
    const book = runMeteoraBook([
      snap({ t: 0, address: "p", name: "MEME", price: 1 }),
      snap({ t: 15_000, address: "p", price: 1.04 }),
    ]);
    expect(book.opens[0]?.priceRatio).toBeCloseTo(1.04);
    expect(book.opens[0]?.result).toBe(0);
    expect(book.opens[0]?.stake).toBeCloseTo(0.25);
    expect(book.equity).toBeCloseTo(1);
  });

  it("opens one 25% position per pool, highest fees/TVL first, and stops at four", () => {
    const book = runMeteoraBook(
      ["a", "b", "c", "d", "e"].map((address, index) =>
        snap({ t: 0, address, name: address, price: 1, fees24h: (5 - index) * 2_000 }),
      ),
    );
    expect(book.opens.map((pos) => pos.address)).toEqual(["a", "b", "c", "d"]);
    expect(book.opens.every((pos) => pos.stake === 0.25)).toBe(true);
    expect(book.cash).toBeCloseTo(0);
    expect(book.equity).toBeCloseTo(1);
    expect(book.trades).toHaveLength(0);
  });

  it("fills the next slot when the leftover is just under 25%", () => {
    const book = runMeteoraBook([
      snap({ t: 0, address: "a", name: "A", price: 1, fees24h: 9_000, fees1h: 400 }),
      snap({ t: 0, address: "b", name: "B", price: 1, fees24h: 8_000 }),
      snap({ t: 0, address: "c", name: "C", price: 1, fees24h: 7_000 }),
      snap({ t: 3_600_000, address: "a", price: 0.99, fees1h: 400 }),
      snap({ t: 3_600_000, address: "d", name: "D", price: 1, fees24h: 6_000 }),
    ]);
    expect(book.opens.map((pos) => pos.address)).toContain("d");
    expect(book.cash).toBeLessThan(0.01);
  });

  it("closes a pool by hand and does not open that name again", () => {
    const book = runMeteoraBook(
      [
        snap({ t: 0, address: "p", name: "MEME", price: 1, fees24h: 9_000 }),
        snap({ t: 10_000, address: "p", price: 1.04 }),
        snap({ t: 20_000, address: "p", price: 1.04, fees24h: 9_000 }),
        snap({ t: 20_000, address: "other", name: "OTHER", price: 1, fees24h: 8_000 }),
      ],
      undefined,
      undefined,
      undefined,
      { manualCloses: [{ address: "p", name: "MEME", at: 15_000 }] },
    );
    expect(book.trades.map((trade) => trade.reason)).toEqual(["manual"]);
    expect(book.trades[0]?.result).toBe(0);
    expect(book.opens.map((pos) => pos.address)).toEqual(["other"]);
  });

  it("keeps earlier stakes and opens later ones at the smaller size", () => {
    const book = runMeteoraBook(
      [
        snap({ t: 0, address: "a", name: "A", price: 1, fees24h: 9_000 }),
        snap({ t: 0, address: "b", name: "B", price: 1, fees24h: 8_000 }),
        snap({ t: 10_000, address: "c", name: "C", price: 1, fees24h: 7_000 }),
        snap({ t: 10_000, address: "d", name: "D", price: 1, fees24h: 6_000 }),
        snap({ t: 10_000, address: "e", name: "E", price: 1, fees24h: 5_000 }),
      ],
      undefined,
      undefined,
      undefined,
      { resizeFrom: 5_000, slot: 0.1 },
    );
    expect(book.opens.find((pos) => pos.address === "a")?.stake).toBeCloseTo(0.25);
    expect(book.opens.find((pos) => pos.address === "b")?.stake).toBeCloseTo(0.25);
    const later = book.opens.filter((pos) => pos.entryT === 10_000);
    expect(later.map((pos) => pos.address)).toEqual(["c", "d", "e"]);
    expect(later.every((pos) => Math.abs(pos.stake - 0.1) < 1e-9)).toBe(true);
  });

  it("does not put two slots in pools that share a name", () => {
    const book = runMeteoraBook([
      snap({ t: 0, address: "weft-a", name: "WEFT-SOL", price: 1, fees24h: 9_000 }),
      snap({ t: 0, address: "weft-b", name: "WEFT-SOL", price: 1, fees24h: 4_000 }),
      snap({ t: 0, address: "other", name: "OTHER-SOL", price: 1, fees24h: 3_000 }),
    ]);
    expect(book.opens.map((pos) => pos.address)).toEqual(["weft-a", "other"]);
  });

  it("caps fee credit at one hour when a snapshot is late", () => {
    const steady = runMeteoraBook([
      snap({ t: 0, address: "p", price: 1 }),
      snap({ t: 3_600_000, address: "p", price: 0.9, fees1h: 500 }),
    ]);
    const late = runMeteoraBook([
      snap({ t: 0, address: "p", price: 1 }),
      snap({ t: 6 * 3_600_000, address: "p", price: 0.9, fees1h: 500 }),
    ]);
    expect(steady.opens[0]?.fees).toBeCloseTo(500 / 50_000);
    expect(late.opens[0]?.fees).toBeCloseTo(steady.opens[0]!.fees);
  });

  it("adds a take-profit only on the 25% stake and does not re-enter that pool on the same snapshot", () => {
    const book = runMeteoraBook([
      snap({ t: 0, address: "p", name: "MEME", price: 1, fees1h: 5_000 }),
      snap({ t: 3_600_000, address: "p", price: 0.99, fees1h: 5_000 }),
      snap({ t: 3_600_000, address: "other", name: "OTHER", price: 1, fees24h: 9_000 }),
    ]);
    expect(book.trades[0]?.reason).toBe("take-profit");
    expect(book.trades[0]?.result).toBeGreaterThanOrEqual(0.08);
    expect(book.equity).toBeCloseTo(1 + 0.25 * book.trades[0].result);
    expect(book.opens.map((pos) => pos.address)).toEqual(["other"]);
    expect(book.opens[0]?.entryT).toBe(book.trades[0]?.exitT);
  });

  it("keeps a full-size trade from before the 25% rule and frees the rest afterwards", () => {
    const early = runMeteoraBook(
      [
        snap({ t: 0, address: "old", name: "OLD", price: 1, fees24h: 9_000, fees1h: 5_000 }),
        snap({ t: 0, address: "other", name: "OTHER", price: 1, fees24h: 8_000 }),
        snap({ t: 3_600_000, address: "old", price: 0.99, fees1h: 5_000 }),
      ],
      undefined,
      undefined,
      undefined,
      { slotFrom: 7_200_000 },
    );
    expect(early.trades).toHaveLength(1);
    expect(early.trades[0]?.result).toBeGreaterThanOrEqual(0.08);
    expect(early.equity).toBeCloseTo(1 + early.trades[0].result);
    expect(early.opens).toHaveLength(0);

    const switched = runMeteoraBook(
      [
        snap({ t: 0, address: "old", name: "OLD", price: 1, fees24h: 9_000 }),
        snap({ t: 0, address: "other", name: "OTHER", price: 1, fees24h: 8_000 }),
        snap({ t: 10_000, address: "old", price: 1.1 }),
        snap({ t: 10_000, address: "other", price: 2, fees24h: 8_000 }),
      ],
      undefined,
      undefined,
      undefined,
      { slotFrom: 5_000 },
    );
    expect(switched.trades).toHaveLength(0);
    expect(switched.opens.map((pos) => pos.address)).toEqual(["old", "other"]);
    expect(switched.opens[0]?.stake).toBeCloseTo(0.25);
    expect(switched.opens[1]?.stake).toBeCloseTo(0.25);
    expect(switched.equity).toBeCloseTo(1);
    expect(switched.opens[0]?.priceRatio).toBeCloseTo(1.1);
    expect(switched.opens[0]?.result).toBe(0);
  });
});
