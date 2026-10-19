import { adx, atr, ema, highest, lowest, rsi, sessionBar, sma, vwap, type Candle } from "./indicators";

/**
 * Long-only spot strategies. Each one decides on a CLOSED bar; the caller
 * fills at the next bar's open. Stops are absolute prices.
 *
 * - tendencia: Donchian breakout with a trend and ADX filter, ATR chandelier
 *   exit. The Turtle / time-series-momentum family, the most documented edge
 *   in crypto and futures.
 * - retroceso: Connors RSI(2) pullback inside a long-term uptrend. Buys short
 *   dips, sells the bounce. High win rate, small wins.
 * - cruce: EMA 20/50 crossover above the 200 EMA with an ATR trailing stop.
 *   Slow, few trades, rides large trends.
 * - regimen: hold while price is above its 200 SMA and the 50 EMA confirms
 *   (Faber's trend filter). Keeps most of the bull market, sidesteps most of
 *   the crashes.
 * - vwap: intraday VWAP + EMA 9/20 pullback. Long only above the session
 *   VWAP with the fast EMA over the slow one, entering when price reclaims
 *   the EMA 9 after a dip. Flat at the end of each UTC session.
 * - vwap9: the plain scalping version. Above the VWAP, buy the close back
 *   over the EMA 9, sell the close back under it.
 */

export type StrategyId = "cruce" | "regimen" | "tendencia" | "retroceso" | "vwap" | "vwap9";

export const STRATEGY_IDS: StrategyId[] = ["cruce", "regimen", "tendencia", "retroceso", "vwap", "vwap9"];

export type Indicators = {
  candles: Candle[];
  close: number[];
  ema9: number[];
  ema20: number[];
  ema50: number[];
  ema200: number[];
  sma5: number[];
  sma200: number[];
  rsi2: number[];
  rsi14: number[];
  atr14: number[];
  adx14: number[];
  donHigh20: number[];
  donLow10: number[];
  vwap: number[];
  sessionBar: number[];
};

export function computeIndicators(candles: Candle[]): Indicators {
  const close = candles.map((bar) => bar.c);
  const highs = candles.map((bar) => bar.h);
  const lows = candles.map((bar) => bar.l);
  return {
    candles,
    close,
    ema9: ema(close, 9),
    ema20: ema(close, 20),
    ema50: ema(close, 50),
    ema200: ema(close, 200),
    sma5: sma(close, 5),
    sma200: sma(close, 200),
    rsi2: rsi(close, 2),
    rsi14: rsi(close, 14),
    atr14: atr(candles, 14),
    adx14: adx(candles, 14),
    donHigh20: highest(highs, 20),
    donLow10: lowest(lows, 10),
    vwap: vwap(candles),
    sessionBar: sessionBar(candles),
  };
}

export type OpenTrade = {
  entryT: number;
  /** Closed bars processed since the fill, including the entry bar. */
  barsHeld: number;
  entryPrice: number;
  stop: number;
  /** Highest high since entry, for the chandelier trail. */
  peak: number;
};

export type Strategy = {
  id: StrategyId;
  name: string;
  summary: string;
  /** Bars needed before the first decision. */
  warmup: number;
  entry(ind: Indicators, i: number): { stop: number; note: string } | null;
  manage(ind: Indicators, i: number, trade: OpenTrade): { exit: boolean; stop: number; note?: string };
};

const ok = (...values: number[]) => values.every((value) => Number.isFinite(value));

const tendencia: Strategy = {
  id: "tendencia",
  name: "Tendencia (ruptura Donchian)",
  summary:
    "Compra cuando el cierre rompe el máximo de 20 velas, con la EMA 50 sobre la EMA 200 y ADX > 20. Stop inicial 2,5 ATR y salida por trailing de 3 ATR o cierre bajo el mínimo de 10 velas.",
  warmup: 210,
  entry(ind, i) {
    const close = ind.close[i];
    const prevHigh = ind.donHigh20[i - 1];
    const a = ind.atr14[i];
    if (!ok(close, prevHigh, a, ind.ema50[i], ind.ema200[i], ind.adx14[i])) return null;
    if (!(ind.ema50[i] > ind.ema200[i] && close > ind.ema200[i])) return null;
    if (!(ind.adx14[i] > 20)) return null;
    if (!(close > prevHigh)) return null;
    return { stop: close - 2.5 * a, note: "Ruptura de máximo de 20 velas en tendencia alcista" };
  },
  manage(ind, i, trade) {
    const a = ind.atr14[i];
    const trail = trade.peak - 3 * a;
    const stop = Number.isFinite(trail) ? Math.max(trade.stop, trail) : trade.stop;
    const floor = ind.donLow10[i - 1];
    if (Number.isFinite(floor) && ind.close[i] < floor) {
      return { exit: true, stop, note: "Cierre bajo el mínimo de 10 velas" };
    }
    return { exit: false, stop };
  },
};

const retroceso: Strategy = {
  id: "retroceso",
  name: "Retroceso RSI(2)",
  summary:
    "Compra caídas cortas (RSI 2 < 10) mientras el precio está sobre la SMA 200. Vende cuando el cierre supera la SMA 5 o tras 10 velas. Stop de catástrofe a 3 ATR.",
  warmup: 205,
  entry(ind, i) {
    const close = ind.close[i];
    const a = ind.atr14[i];
    if (!ok(close, a, ind.sma200[i], ind.rsi2[i])) return null;
    if (!(close > ind.sma200[i])) return null;
    if (!(ind.rsi2[i] < 10)) return null;
    return { stop: close - 3 * a, note: `RSI(2) ${ind.rsi2[i].toFixed(1)} sobre la SMA 200` };
  },
  manage(ind, i, trade) {
    if (Number.isFinite(ind.sma5[i]) && ind.close[i] > ind.sma5[i]) {
      return { exit: true, stop: trade.stop, note: "Cierre sobre la SMA 5" };
    }
    if (trade.barsHeld >= 10) {
      return { exit: true, stop: trade.stop, note: "Salida por tiempo (10 velas)" };
    }
    return { exit: false, stop: trade.stop };
  },
};

const cruce: Strategy = {
  id: "cruce",
  name: "Cruce EMA 20/50",
  summary:
    "Compra cuando la EMA 20 cruza sobre la EMA 50 con el precio sobre la EMA 200. Sale cuando la EMA 20 cruza bajo la EMA 50. Trailing de 3 ATR.",
  warmup: 210,
  entry(ind, i) {
    const close = ind.close[i];
    const a = ind.atr14[i];
    if (!ok(close, a, ind.ema20[i], ind.ema50[i], ind.ema20[i - 1], ind.ema50[i - 1], ind.ema200[i])) {
      return null;
    }
    const crossed = ind.ema20[i - 1] <= ind.ema50[i - 1] && ind.ema20[i] > ind.ema50[i];
    if (!crossed || !(close > ind.ema200[i])) return null;
    return { stop: close - 3 * a, note: "EMA 20 cruzó sobre la EMA 50" };
  },
  manage(ind, i, trade) {
    const a = ind.atr14[i];
    const trail = trade.peak - 3 * a;
    const stop = Number.isFinite(trail) ? Math.max(trade.stop, trail) : trade.stop;
    if (ind.ema20[i] < ind.ema50[i]) return { exit: true, stop, note: "EMA 20 bajo la EMA 50" };
    return { exit: false, stop };
  },
};

const regimen: Strategy = {
  id: "regimen",
  name: "Régimen SMA 200",
  summary:
    "Mantiene la posición mientras el cierre está sobre la SMA 200 y la EMA 50 sobre la SMA 200. Sale al cerrar bajo la SMA 200. Stop de catástrofe a 5 ATR.",
  warmup: 205,
  entry(ind, i) {
    const close = ind.close[i];
    const a = ind.atr14[i];
    if (!ok(close, a, ind.sma200[i], ind.ema50[i])) return null;
    if (!(close > ind.sma200[i] && ind.ema50[i] > ind.sma200[i])) return null;
    return { stop: close - 5 * a, note: "Precio y EMA 50 sobre la SMA 200" };
  },
  manage(ind, i, trade) {
    if (Number.isFinite(ind.sma200[i]) && ind.close[i] < ind.sma200[i]) {
      return { exit: true, stop: trade.stop, note: "Cierre bajo la SMA 200" };
    }
    return { exit: false, stop: trade.stop };
  },
};

const DAY_MS = 86_400_000;

function lastBarOfSession(ind: Indicators, i: number): boolean {
  const candles = ind.candles;
  const step = i > 0 ? candles[i].t - candles[i - 1].t : 0;
  return step > 0 && Math.floor((candles[i].t + step) / DAY_MS) !== Math.floor(candles[i].t / DAY_MS);
}

const vwapStrategy: Strategy = {
  id: "vwap",
  name: "VWAP + EMA 9/20 (intradía)",
  summary:
    "Solo compra sobre el VWAP de la sesión con la EMA 9 sobre la EMA 20, cuando el precio recupera la EMA 9 tras un retroceso. Stop 1,5 ATR, objetivo 2 R, sale si cierra bajo el VWAP y cierra todo al final de la sesión UTC.",
  warmup: 30,
  entry(ind, i) {
    const close = ind.close[i];
    const a = ind.atr14[i];
    if (!ok(close, a, ind.vwap[i], ind.ema9[i], ind.ema20[i], ind.ema9[i - 1])) return null;
    // Skip the first 30 minutes of the session (VWAP still unstable) and its last bar.
    const step = ind.candles[i].t - ind.candles[i - 1].t;
    if (ind.sessionBar[i] * step < 30 * 60_000 || lastBarOfSession(ind, i)) return null;
    if (!(close > ind.vwap[i] && ind.ema9[i] > ind.ema20[i])) return null;
    const dipped = ind.close[i - 1] <= ind.ema9[i - 1];
    if (!dipped || !(close > ind.ema9[i])) return null;
    return { stop: close - 1.5 * a, note: "Recupera la EMA 9 sobre el VWAP" };
  },
  manage(ind, i, trade) {
    const close = ind.close[i];
    if (lastBarOfSession(ind, i)) return { exit: true, stop: trade.stop, note: "Fin de la sesión" };
    if (Number.isFinite(ind.vwap[i]) && close < ind.vwap[i]) {
      return { exit: true, stop: trade.stop, note: "Cierre bajo el VWAP" };
    }
    // Target 2R: the initial stop is 1.5 ATR away, so 2R is 3 ATR above the entry.
    const a = ind.atr14[i];
    if (Number.isFinite(a) && close >= trade.entryPrice + 3 * a) {
      return { exit: true, stop: trade.stop, note: "Objetivo 2 R" };
    }
    return { exit: false, stop: trade.stop };
  },
};

const vwap9: Strategy = {
  id: "vwap9",
  name: "VWAP + EMA 9 (scalping)",
  summary:
    "Sobre el VWAP de la sesión, compra cuando el cierre cruza sobre la EMA 9 y vende cuando cruza bajo ella. Stop 1,5 ATR. Cierra todo al final de la sesión UTC.",
  warmup: 30,
  entry(ind, i) {
    const close = ind.close[i];
    const a = ind.atr14[i];
    if (!ok(close, a, ind.vwap[i], ind.ema9[i], ind.ema9[i - 1])) return null;
    const step = ind.candles[i].t - ind.candles[i - 1].t;
    if (ind.sessionBar[i] * step < 30 * 60_000 || lastBarOfSession(ind, i)) return null;
    if (!(close > ind.vwap[i])) return null;
    if (!(ind.close[i - 1] <= ind.ema9[i - 1] && close > ind.ema9[i])) return null;
    return { stop: close - 1.5 * a, note: "Cruce sobre la EMA 9 encima del VWAP" };
  },
  manage(ind, i, trade) {
    if (lastBarOfSession(ind, i)) return { exit: true, stop: trade.stop, note: "Fin de la sesión" };
    if (Number.isFinite(ind.ema9[i]) && ind.close[i] < ind.ema9[i]) {
      return { exit: true, stop: trade.stop, note: "Cierre bajo la EMA 9" };
    }
    return { exit: false, stop: trade.stop };
  },
};

export const STRATEGIES: Record<StrategyId, Strategy> = {
  cruce,
  regimen,
  tendencia,
  retroceso,
  vwap: vwapStrategy,
  vwap9,
};

export function isStrategyId(value: unknown): value is StrategyId {
  return typeof value === "string" && (STRATEGY_IDS as string[]).includes(value);
}
