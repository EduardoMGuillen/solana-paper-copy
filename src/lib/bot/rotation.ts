import type { Candle } from "./indicators";

/**
 * Cross-sectional momentum rotation on daily bars.
 *
 * Each day at the close, rank the tradable tokens by their return over
 * `lookback` days, keep only those in their own uptrend, and hold the
 * strongest `top`. Everything else sits in USDC. Orders fill at the next
 * day's open. Momentum is the most persistent factor in crypto returns
 * (Liu & Tsyvinski 2021; Liu, Tsyvinski & Wu 2022). Concentrating in one
 * or two names is what makes this aggressive.
 */

export type RotationParams = {
  /** Days of return used to rank. */
  lookback: number;
  /** How many tokens to hold at once. */
  top: number;
  /** A token must close above its own EMA of this length. 0 disables. */
  trendEma: number;
  /** Go fully to cash while BTC closes under its SMA of this length. 0 disables. */
  btcSma: number;
  /** Keep a holding while it stays within top + buffer, to cut churn. */
  buffer: number;
  /** Exit when the close falls this far from the highest close since entry. 0 disables. */
  trail: number;
};

export type Panel = {
  times: number[];
  symbols: string[];
  tradable: boolean[];
  open: number[][];
  high: number[][];
  low: number[][];
  close: number[][];
};

/** Align daily candles by UTC day. Missing days (not yet listed) are NaN. */
export function buildPanel(series: Record<string, Candle[]>, tradable: (symbol: string) => boolean): Panel {
  const symbols = Object.keys(series);
  const times = [...new Set(symbols.flatMap((s) => series[s].map((c) => c.t)))].sort((a, b) => a - b);
  const index = new Map(times.map((t, i) => [t, i]));
  const blank = () => times.map(() => Number.NaN);
  const panel: Panel = {
    times,
    symbols,
    tradable: symbols.map(tradable),
    open: symbols.map(blank),
    high: symbols.map(blank),
    low: symbols.map(blank),
    close: symbols.map(blank),
  };
  symbols.forEach((symbol, s) => {
    for (const c of series[symbol]) {
      const i = index.get(c.t)!;
      panel.open[s][i] = c.o;
      panel.high[s][i] = c.h;
      panel.low[s][i] = c.l;
      panel.close[s][i] = c.c;
    }
  });
  return panel;
}

function emaSeries(values: number[], period: number): number[] {
  const out = values.map(() => Number.NaN);
  const k = 2 / (period + 1);
  let prev = Number.NaN;
  let seen = 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      prev = Number.NaN;
      seen = 0;
      sum = 0;
      continue;
    }
    if (seen < period) {
      sum += v;
      seen += 1;
      if (seen === period) prev = sum / period;
    } else prev = v * k + prev * (1 - k);
    out[i] = seen >= period ? prev : Number.NaN;
  }
  return out;
}

function smaSeries(values: number[], period: number): number[] {
  return values.map((_, i) => {
    if (i < period - 1) return Number.NaN;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j += 1) sum += values[j];
    return sum / period;
  });
}

export type RotationSignals = { ema: number[][]; btcSma: number[] | null; btcIndex: number };

export function precompute(panel: Panel, params: RotationParams): RotationSignals {
  const btcIndex = panel.symbols.indexOf("BTC");
  return {
    ema: params.trendEma > 0 ? panel.close.map((closes) => emaSeries(closes, params.trendEma)) : [],
    btcSma: params.btcSma > 0 && btcIndex >= 0 ? smaSeries(panel.close[btcIndex], params.btcSma) : null,
    btcIndex,
  };
}

export type Ranked = { symbol: string; score: number; eligible: boolean; why: string };

/** Rank every tradable token on day i using closes up to and including i. */
export function rankDay(panel: Panel, signals: RotationSignals, params: RotationParams, i: number): Ranked[] {
  const out: Ranked[] = [];
  panel.symbols.forEach((symbol, s) => {
    if (!panel.tradable[s]) return;
    const now = panel.close[s][i];
    const past = panel.close[s][i - params.lookback];
    if (!Number.isFinite(now) || !Number.isFinite(past) || past <= 0) return;
    const score = now / past - 1;
    let eligible = score > 0;
    let why = eligible ? "momentum positivo" : "momentum negativo";
    if (eligible && params.trendEma > 0) {
      const e = signals.ema[s][i];
      if (!Number.isFinite(e) || now <= e) {
        eligible = false;
        why = `bajo su EMA ${params.trendEma}`;
      }
    }
    out.push({ symbol, score, eligible, why });
  });
  return out.sort((a, b) => b.score - a.score);
}

export function riskOff(panel: Panel, signals: RotationSignals, i: number): boolean {
  if (!signals.btcSma) return false;
  const sma = signals.btcSma[i];
  const close = panel.close[signals.btcIndex][i];
  return Number.isFinite(sma) && Number.isFinite(close) && close < sma;
}

/**
 * Which symbols to hold after day i's close, given what is held now.
 * Holdings survive while eligible and inside top + buffer; free slots go
 * to the best-ranked eligible tokens.
 */
export function chooseTargets(ranked: Ranked[], held: string[], params: RotationParams, off: boolean): string[] {
  if (off) return [];
  const eligible = ranked.filter((r) => r.eligible);
  const keepZone = new Set(eligible.slice(0, params.top + params.buffer).map((r) => r.symbol));
  const targets = held.filter((symbol) => keepZone.has(symbol)).slice(0, params.top);
  for (const r of eligible) {
    if (targets.length >= params.top) break;
    if (!targets.includes(r.symbol)) targets.push(r.symbol);
  }
  return targets;
}

export type RotationTrade = {
  symbol: string;
  entryT: number;
  exitT: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  ret: number;
  reason: string;
};

export type Holding = { symbol: string; qty: number; cost: number; entryT: number; entryPrice: number; peak: number };

export type RotationBook = { cash: number; holdings: Holding[]; trades: RotationTrade[] };

export type Costs = { feeBps: number; slippageBps: number };

export function bookEquity(book: RotationBook, price: (symbol: string) => number, costs: Costs): number {
  const haircut = (1 - costs.slippageBps / 10_000) * (1 - costs.feeBps / 10_000);
  return book.cash + book.holdings.reduce((sum, h) => sum + h.qty * price(h.symbol) * haircut, 0);
}

export function sellHolding(book: RotationBook, symbol: string, rawPrice: number, t: number, reason: string, costs: Costs): RotationTrade | null {
  const h = book.holdings.find((item) => item.symbol === symbol);
  if (!h || !(rawPrice > 0)) return null;
  const price = rawPrice * (1 - costs.slippageBps / 10_000);
  const proceeds = h.qty * price * (1 - costs.feeBps / 10_000);
  book.cash += proceeds;
  book.holdings = book.holdings.filter((item) => item !== h);
  const trade = { symbol, entryT: h.entryT, exitT: t, entryPrice: h.entryPrice, exitPrice: price, pnl: proceeds - h.cost, ret: proceeds / h.cost - 1, reason };
  book.trades.push(trade);
  return trade;
}

export function buyHolding(book: RotationBook, symbol: string, rawPrice: number, budget: number, t: number, costs: Costs): Holding | null {
  const spend = Math.min(budget, book.cash);
  if (!(rawPrice > 0) || spend < 0.5) return null;
  const price = rawPrice * (1 + costs.slippageBps / 10_000);
  const qty = (spend / (1 + costs.feeBps / 10_000)) / price;
  book.cash = Math.max(0, book.cash - spend);
  const h: Holding = { symbol, qty, cost: spend, entryT: t, entryPrice: price, peak: price };
  book.holdings.push(h);
  return h;
}

/**
 * Execute the orders decided at the close of day i-1 at day i's open, after
 * checking trailing exits. Returns the new targets decided at day i's close.
 */
export function rebalanceAtOpen(
  book: RotationBook,
  panel: Panel,
  i: number,
  targets: string[],
  params: RotationParams,
  costs: Costs,
): void {
  const t = panel.times[i];
  const openOf = (symbol: string) => panel.open[panel.symbols.indexOf(symbol)][i];
  for (const h of [...book.holdings]) {
    if (!targets.includes(h.symbol)) sellHolding(book, h.symbol, openOf(h.symbol), t, "Rotación", costs);
  }
  const fresh = targets.filter((symbol) => !book.holdings.some((h) => h.symbol === symbol));
  if (fresh.length === 0) return;
  const equity = bookEquity(book, openOf, costs);
  const slot = equity / params.top;
  const each = Math.min(slot, book.cash / fresh.length);
  for (const symbol of fresh) buyHolding(book, symbol, openOf(symbol), each, t, costs);
}

/** Trailing exit on day i's close. Returns symbols that must be sold at the next open. */
export function trailingExits(book: RotationBook, panel: Panel, i: number, params: RotationParams): string[] {
  const out: string[] = [];
  for (const h of book.holdings) {
    const close = panel.close[panel.symbols.indexOf(h.symbol)][i];
    if (!Number.isFinite(close)) continue;
    h.peak = Math.max(h.peak, close);
    if (params.trail > 0 && close < h.peak * (1 - params.trail)) out.push(h.symbol);
  }
  return out;
}

export type RotationResult = {
  equity: { t: number; equity: number }[];
  trades: RotationTrade[];
  /** Fraction of days with at least one holding. */
  exposure: number;
};

export function simulateRotation(
  panel: Panel,
  params: RotationParams,
  options: { capital: number; costs: Costs; from: number; to: number },
): RotationResult {
  const signals = precompute(panel, params);
  const book: RotationBook = { cash: options.capital, holdings: [], trades: [] };
  const equity: { t: number; equity: number }[] = [];
  let targets: string[] = [];
  let invested = 0;
  for (let i = options.from; i <= options.to; i += 1) {
    if (i > options.from) rebalanceAtOpen(book, panel, i, targets, params, options.costs);
    const closeOf = (symbol: string) => panel.close[panel.symbols.indexOf(symbol)][i];
    const exits = trailingExits(book, panel, i, params);
    const ranked = rankDay(panel, signals, params, i);
    const held = book.holdings.map((h) => h.symbol).filter((s) => !exits.includes(s));
    targets = chooseTargets(ranked, held, params, riskOff(panel, signals, i)).filter((s) => !exits.includes(s));
    if (book.holdings.length > 0) invested += 1;
    equity.push({ t: panel.times[i], equity: bookEquity(book, closeOf, options.costs) });
  }
  return { equity, trades: book.trades, exposure: invested / Math.max(1, equity.length) };
}
