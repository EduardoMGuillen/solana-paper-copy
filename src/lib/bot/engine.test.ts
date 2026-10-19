import { describe, expect, it } from "vitest";
import { runBacktest, walkForward } from "./backtest";
import { createBotState, markAccount, onCandles, setHalt } from "./engine";
import type { Candle } from "./indicators";
import { INTERVAL_MS } from "./market";
import { defaultBotSettings } from "./settings";

const H4 = INTERVAL_MS["4h"];

/** Deterministic trending-with-pullbacks series so the strategies trade. */
function synthetic(n: number, seed = 7): Candle[] {
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i += 1) {
    const drift = Math.sin(i / 40) * 0.006 + 0.0005;
    const o = price;
    const c = Math.max(1, o * (1 + drift + (rand() - 0.5) * 0.03));
    const h = Math.max(o, c) * (1 + rand() * 0.01);
    const l = Math.min(o, c) * (1 - rand() * 0.01);
    out.push({ t: i * H4, o, h, l, c, v: 1 });
    price = c;
  }
  return out;
}

describe("live engine", () => {
  for (const strategy of ["tendencia", "retroceso", "regimen"] as const) {
    it(`${strategy}: trades exactly like the backtest when fed the same bars one by one`, () => {
      const candles = synthetic(1500);
      const settings = { ...defaultBotSettings, markets: ["SOL"], strategy };
      const start = 400;
      const state = createBotState(0, settings);
      const book = state.books[0];
      // Each poll sees the full history plus one more closed bar.
      for (let k = start; k <= candles.length; k += 1) {
        onCandles(state, book, candles.slice(0, k), k * H4);
      }
      const bt = runBacktest(candles, strategy, {
        capital: 100,
        costs: { feeBps: settings.feeBps, slippageBps: settings.slippageBps },
        sizing: { riskPerTrade: settings.riskPerTrade, maxExposure: settings.maxExposure },
        tradeFrom: start,
      });
      expect(bt.trades.length).toBeGreaterThan(3);
      expect(book.sleeve.trades.map((t) => t.entryT)).toEqual(bt.trades.map((t) => t.entryT));
      expect(book.sleeve.trades.map((t) => t.exitT)).toEqual(bt.trades.map((t) => t.exitT));
      expect(book.sleeve.trades.map((t) => t.pnl.toFixed(9))).toEqual(bt.trades.map((t) => t.pnl.toFixed(9)));
    });
  }

  it("values a 1 SOL account at the SOL price and splits it across markets", () => {
    const state = createBotState(0, { ...defaultBotSettings, startingSol: 1, markets: ["SOL", "BTC"] }, 150);
    expect(state.startingEquity).toBe(150);
    expect(state.books.map((b) => b.sleeve.cash)).toEqual([75, 75]);
  });

  it("does not replay history on first contact", () => {
    const candles = synthetic(800);
    const state = createBotState(0, { ...defaultBotSettings, markets: ["SOL"], strategy: "cruce" });
    onCandles(state, state.books[0], candles, candles.length * H4);
    expect(state.books[0].sleeve.trades).toHaveLength(0);
    expect(state.books[0].sleeve.position).toBeNull();
  });

  it("trips the drawdown halt and only clears it by hand", () => {
    const state = createBotState(0, { ...defaultBotSettings, markets: ["SOL"] });
    state.books[0].sleeve.cash = 70;
    markAccount(state, 1);
    expect(state.halt.drawdown).toBe(true);
    markAccount(state, 2 * 86_400_000);
    expect(state.halt.drawdown).toBe(true);
    setHalt(state, false, 3 * 86_400_000);
    expect(state.halt.drawdown).toBe(false);
  });
});

describe("walk-forward", () => {
  it("reports in-sample and out-of-sample separately", () => {
    const wf = walkForward(synthetic(2000), "cruce", {
      capital: 1000,
      costs: { feeBps: 10, slippageBps: 10 },
      sizing: { riskPerTrade: 0.02, maxExposure: 1 },
    });
    expect(wf.inSample.toT).toBeLessThan(wf.outOfSample.fromT);
    expect(typeof wf.verdict.pass).toBe("boolean");
  });
});
