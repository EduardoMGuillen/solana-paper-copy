import { describe, expect, it } from "vitest";
import { adx, atr, ema, highest, lowest, rsi, sma, type Candle } from "./indicators";

const bars = (closes: number[]): Candle[] =>
  closes.map((c, i) => ({ t: i * 1000, o: c, h: c + 1, l: c - 1, c, v: 1 }));

describe("indicators", () => {
  it("sma and ema warm up with NaN, then match hand values", () => {
    const values = [1, 2, 3, 4, 5, 6];
    expect(sma(values, 3).slice(2)).toEqual([2, 3, 4, 5]);
    expect(Number.isNaN(sma(values, 3)[1])).toBe(true);
    const e = ema(values, 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3);
    expect(e[5]).toBeCloseTo(5);
  });

  it("rsi is 100 on a straight rally and 0 on a straight fall", () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsi(up, 14).at(-1)).toBe(100);
    const down = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(rsi(down, 14).at(-1)).toBe(0);
  });

  it("atr equals the constant range on a flat series", () => {
    const series = bars(Array.from({ length: 40 }, () => 50));
    expect(atr(series, 14).at(-1)).toBeCloseTo(2);
  });

  it("adx is high in a clean trend and low in a flat market", () => {
    const trend = bars(Array.from({ length: 80 }, (_, i) => 100 + i * 2));
    const flat = bars(Array.from({ length: 80 }, (_, i) => 100 + (i % 2)));
    expect(adx(trend, 14).at(-1)!).toBeGreaterThan(40);
    expect(adx(flat, 14).at(-1)!).toBeLessThan(20);
  });

  it("indicators never read the future", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 7) * 10 + i * 0.1);
    const full = ema(closes, 50);
    const cut = ema(closes.slice(0, 200), 50);
    expect(cut[199]).toBe(full[199]);
    expect(highest(closes, 20)[150]).toBe(Math.max(...closes.slice(131, 151)));
    expect(lowest(closes, 10)[150]).toBe(Math.min(...closes.slice(141, 151)));
  });
});
