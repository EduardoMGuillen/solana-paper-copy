import { walkForward, type Metrics } from "./backtest";
import type { Candle } from "./indicators";
import { closedOnly, INTERVAL_MS, type Interval } from "./market";
import type { BotSettings } from "./settings";
import { defaultBotSettings } from "./settings";
import {
  fillAtOpen,
  flatten,
  newSleeve,
  sleeveEquity,
  stepBar,
  stopAtPrice,
  type ClosedTrade,
  type Costs,
  type Sleeve,
  type SizingRules,
  type StepEvent,
} from "./sleeve";
import { computeIndicators, STRATEGIES, STRATEGY_IDS, type StrategyId } from "./strategies";

export const STARTING_USD = 100;
const CURVE_CAP = 2_000;
const LOG_CAP = 200;
const TRADE_CAP = 2_000;

export type StrategyCheck = {
  strategy: StrategyId;
  pass: boolean;
  reasons: string[];
  full: Pick<Metrics, "trades" | "winRate" | "profitFactor" | "expectancyR" | "totalReturn" | "maxDrawdown" | "sharpe" | "buyHoldReturn" | "fromT" | "toT">;
  inSampleSharpe: number | null;
  oosReturn: number;
  /** Downsampled backtest equity, normalized to 1 at the start. */
  curve: { t: number; v: number }[];
};

export type Validation = {
  at: number;
  interval: Interval;
  bars: number;
  checks: StrategyCheck[];
  chosen: StrategyId | null;
};

export type MarketBook = {
  id: string;
  /** Strategy currently driving this sleeve. Null means flat and not trading. */
  strategy: StrategyId | null;
  sleeve: Sleeve;
  lastPrice: number | null;
  lastPriceT: number | null;
  polledAt: number | null;
  error: string | null;
  validation: Validation | null;
};

export type BotTrade = ClosedTrade & { id: string; market: string; strategy: StrategyId | null };

export type LogLine = { id: string; t: number; market: string | null; text: string; tone: "info" | "buy" | "sell" | "warn" };

export type BotState = {
  version: 3;
  seq: number;
  createdAt: number;
  updatedAt: number;
  startingEquity: number;
  /** Paper capital expressed in SOL, valued at the SOL price at creation. */
  startingSol: number;
  solPriceAtStart: number;
  /** Latest SOL price, to report the account in SOL and against holding SOL. */
  solPrice: number;
  settings: BotSettings;
  books: MarketBook[];
  trades: BotTrade[];
  log: LogLine[];
  equityCurve: { t: number; equity: number }[];
  peakEquity: number;
  halt: {
    manual: boolean;
    /** Daily loss tripped. Clears at the next UTC day. */
    daily: boolean;
    /** Account drawdown tripped. Clears only on a manual resume. */
    drawdown: boolean;
    reason: string | null;
    dayKey: string;
    dayStartEquity: number;
  };
};

export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function costsOf(settings: BotSettings): Costs {
  return { feeBps: settings.feeBps, slippageBps: settings.slippageBps };
}

export function sizingOf(settings: BotSettings): SizingRules {
  return { riskPerTrade: settings.riskPerTrade, maxExposure: settings.maxExposure };
}

function nextId(state: BotState, prefix: string): string {
  state.seq += 1;
  return `${prefix}-${state.seq}`;
}

export function addLog(state: BotState, t: number, market: string | null, text: string, tone: LogLine["tone"] = "info"): void {
  state.log.push({ id: nextId(state, "log"), t, market, text, tone });
  if (state.log.length > LOG_CAP) state.log.splice(0, state.log.length - LOG_CAP);
}

function newBook(id: string, capital: number, strategy: StrategyId | null): MarketBook {
  return {
    id,
    strategy,
    sleeve: newSleeve(capital),
    lastPrice: null,
    lastPriceT: null,
    polledAt: null,
    error: null,
    validation: null,
  };
}

function fixedStrategy(settings: BotSettings): StrategyId | null {
  return settings.strategy === "auto" ? null : settings.strategy;
}

/**
 * New paper account worth `settings.startingSol` SOL at `solPrice`.
 * Without a SOL price it falls back to STARTING_USD.
 */
export function createBotState(now: number, settings: BotSettings = defaultBotSettings, solPrice: number | null = null): BotState {
  const price = solPrice && solPrice > 0 ? solPrice : STARTING_USD / settings.startingSol;
  const capital = settings.startingSol * price;
  const slice = capital / settings.markets.length;
  const state: BotState = {
    version: 3,
    seq: 1,
    createdAt: now,
    updatedAt: now,
    startingEquity: capital,
    startingSol: settings.startingSol,
    solPriceAtStart: price,
    solPrice: price,
    settings,
    books: settings.markets.map((id) => newBook(id, slice, fixedStrategy(settings))),
    trades: [],
    log: [],
    equityCurve: [{ t: now, equity: capital }],
    peakEquity: capital,
    halt: { manual: false, daily: false, drawdown: false, reason: null, dayKey: dayKey(now), dayStartEquity: capital },
  };
  addLog(
    state,
    now,
    null,
    `Cuenta de papel creada con ${settings.startingSol} SOL (${capital.toFixed(2)} US$ a ${price.toFixed(2)} US$/SOL), repartidos en ${settings.markets.length} mercados.`,
  );
  return state;
}

export function bookEquity(state: BotState, book: MarketBook): number {
  const price = book.lastPrice ?? book.sleeve.position?.entryPrice ?? 0;
  return sleeveEquity(book.sleeve, price, costsOf(state.settings));
}

export function accountEquity(state: BotState): number {
  return state.books.reduce((sum, book) => sum + bookEquity(state, book), 0);
}

export function entriesAllowed(state: BotState): boolean {
  return !state.halt.manual && !state.halt.daily && !state.halt.drawdown;
}

function recordEvents(state: BotState, book: MarketBook, events: StepEvent[], strategy: StrategyId | null): void {
  for (const event of events) {
    if (event.type === "buy") {
      addLog(state, event.t, book.id, `Compra a ${event.price.toPrecision(5)} · ${event.note}`, "buy");
      continue;
    }
    const trade = event.trade;
    state.trades.push({ ...trade, id: nextId(state, "trade"), market: book.id, strategy });
    if (state.trades.length > TRADE_CAP) state.trades.splice(0, state.trades.length - TRADE_CAP);
    const sign = trade.pnl >= 0 ? "+" : "";
    addLog(
      state,
      trade.exitT,
      book.id,
      `Venta a ${trade.exitPrice.toPrecision(5)} · ${trade.note} · ${sign}${trade.pnl.toFixed(2)} US$ (${trade.r.toFixed(2)} R)`,
      "sell",
    );
  }
}

/**
 * Feed the latest candles (including the forming bar) for one market.
 * Closed bars go through the exact backtest step; the forming bar only fills
 * pending orders at its open and checks the stop against the last price.
 */
export function onCandles(state: BotState, book: MarketBook, candles: Candle[], now: number): void {
  const interval = state.settings.interval;
  const closed = closedOnly(candles, interval, now);
  const forming = candles.length > closed.length ? candles[candles.length - 1] : null;
  const last = candles[candles.length - 1];
  if (last) {
    book.lastPrice = last.c;
    book.lastPriceT = now;
  }
  book.polledAt = now;
  book.error = null;
  if (closed.length === 0) return;

  const sleeve = book.sleeve;
  const costs = costsOf(state.settings);
  const sizing = sizingOf(state.settings);

  if (sleeve.lastT === null) {
    // First contact: start from now, do not replay history as if we had traded it.
    sleeve.lastT = closed[closed.length - 1].t;
    addLog(state, now, book.id, `Mercado listo. Velas de ${interval}; decide al cierre de cada vela.`);
  }

  const strategyId = book.strategy;
  if (strategyId) {
    const strategy = STRATEGIES[strategyId];
    const ind = computeIndicators(closed);
    for (let i = 0; i < closed.length; i += 1) {
      if (closed[i].t <= sleeve.lastT) continue;
      recordEvents(state, book, stepBar(sleeve, strategy, ind, i, costs, sizing, entriesAllowed(state)), strategyId);
    }
  } else {
    sleeve.lastT = closed[closed.length - 1].t;
  }

  if (forming) {
    recordEvents(state, book, fillAtOpen(sleeve, forming, costs, sizing, entriesAllowed(state) && Boolean(strategyId)), strategyId);
    const stopped = stopAtPrice(sleeve, forming.c, now, costs);
    if (stopped) recordEvents(state, book, [{ type: "sell", trade: stopped }], strategyId);
  }
}

/** Mark the account, roll the day and trip the halts. Call once per tick. */
export function markAccount(state: BotState, now: number): void {
  const equity = accountEquity(state);
  const key = dayKey(now);
  if (state.halt.dayKey !== key) {
    state.halt.dayKey = key;
    state.halt.dayStartEquity = equity;
    if (state.halt.daily) {
      state.halt.daily = false;
      addLog(state, now, null, "Nuevo día UTC: se levanta el corte por pérdida diaria.");
    }
  }
  state.peakEquity = Math.max(state.peakEquity, equity);
  const settings = state.settings;
  if (!state.halt.daily && equity <= state.halt.dayStartEquity * (1 - settings.dailyLossHalt)) {
    state.halt.daily = true;
    addLog(state, now, null, `Pérdida del día ≥ ${(settings.dailyLossHalt * 100).toFixed(0)}%. Sin entradas nuevas hasta mañana.`, "warn");
  }
  if (!state.halt.drawdown && equity <= state.peakEquity * (1 - settings.maxDrawdownHalt)) {
    state.halt.drawdown = true;
    addLog(state, now, null, `Drawdown ≥ ${(settings.maxDrawdownHalt * 100).toFixed(0)}% desde el máximo. Sin entradas nuevas hasta reanudar a mano.`, "warn");
  }
  state.halt.reason = state.halt.manual
    ? "Pausa manual. Las posiciones abiertas siguen con sus stops."
    : state.halt.drawdown
      ? "Corte por drawdown de la cuenta. Revisa antes de reanudar."
      : state.halt.daily
        ? "Corte por pérdida diaria. Se levanta solo al cambiar el día UTC."
        : null;

  const lastPoint = state.equityCurve[state.equityCurve.length - 1];
  if (!lastPoint || now - lastPoint.t >= 60_000) {
    state.equityCurve.push({ t: now, equity });
    if (state.equityCurve.length > CURVE_CAP) state.equityCurve.splice(0, state.equityCurve.length - CURVE_CAP);
  }
  state.updatedAt = now;
}

function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i += 1) out.push(items[Math.floor(i * step)]);
  out.push(items[items.length - 1]);
  return out;
}

/** Walk-forward every strategy on this market's history and pick one. */
export function validateMarket(settings: BotSettings, candles: Candle[], now: number): Validation {
  const options = { capital: 1_000, costs: costsOf(settings), sizing: sizingOf(settings) };
  // A riskier profile is allowed a deeper drawdown, but never past 40%.
  const maxDrawdown = Math.min(0.4, Math.max(0.25, settings.riskPerTrade * 8));
  const checks: StrategyCheck[] = STRATEGY_IDS.map((id) => {
    const wf = walkForward(candles, id, options, 0.7, maxDrawdown);
    const m = wf.full.metrics;
    const start = wf.full.equity[0]?.equity ?? 1;
    return {
      strategy: id,
      pass: wf.verdict.pass,
      reasons: wf.verdict.reasons,
      full: {
        trades: m.trades,
        winRate: m.winRate,
        profitFactor: m.profitFactor,
        expectancyR: m.expectancyR,
        totalReturn: m.totalReturn,
        maxDrawdown: m.maxDrawdown,
        sharpe: m.sharpe,
        buyHoldReturn: m.buyHoldReturn,
        fromT: m.fromT,
        toT: m.toT,
      },
      inSampleSharpe: wf.inSample.sharpe,
      oosReturn: wf.outOfSample.totalReturn,
      curve: downsample(wf.full.equity, 160).map((point) => ({ t: point.t, v: point.equity / start })),
    };
  });
  // Rank passing strategies by in-sample Sharpe, so the OOS block stays a check, not a selector.
  const chosen =
    checks
      .filter((check) => check.pass)
      .sort((a, b) => (b.inSampleSharpe ?? -Infinity) - (a.inSampleSharpe ?? -Infinity))[0]?.strategy ?? null;
  return { at: now, interval: settings.interval, bars: candles.length, checks, chosen };
}

/** Apply a fresh validation. In auto mode a flat book may switch strategy. */
export function applyValidation(state: BotState, book: MarketBook, validation: Validation, now: number): void {
  book.validation = validation;
  if (state.settings.strategy !== "auto") return;
  if (book.strategy === validation.chosen) return;
  if (book.sleeve.position) {
    // Never abandon an open trade mid-way; switch once it is closed.
    return;
  }
  const before = book.strategy;
  book.strategy = validation.chosen;
  book.sleeve.pending = null;
  addLog(
    state,
    now,
    book.id,
    validation.chosen
      ? `Estrategia ${before ? `${STRATEGIES[before].name} → ` : ""}${STRATEGIES[validation.chosen].name} (pasó walk-forward).`
      : "Ninguna estrategia pasó la validación. Este mercado queda sin operar.",
    validation.chosen ? "info" : "warn",
  );
}

export function validationDue(state: BotState, book: MarketBook, now: number): boolean {
  const v = book.validation;
  if (!v) return true;
  if (v.interval !== state.settings.interval) return true;
  return now - v.at >= 24 * 3_600_000;
}

/**
 * Settings change. Changing markets, interval or the strategy mode closes
 * every position at the last price and re-splits the account evenly.
 */
export function applySettings(state: BotState, next: BotSettings, now: number): void {
  const prev = state.settings;
  const structural =
    prev.interval !== next.interval ||
    prev.strategy !== next.strategy ||
    prev.markets.join(",") !== next.markets.join(",");
  state.settings = next;
  if (!structural) {
    addLog(state, now, null, "Ajustes de riesgo guardados.");
    return;
  }
  const costs = costsOf(next);
  for (const book of state.books) {
    if (!book.sleeve.position) continue;
    const price = book.lastPrice ?? book.sleeve.position.entryPrice;
    const trade = flatten(book.sleeve, price, now, costs, "Cierre por cambio de ajustes");
    if (trade) recordEvents(state, book, [{ type: "sell", trade }], book.strategy);
  }
  const equity = accountEquity(state);
  const slice = equity / next.markets.length;
  const previous = new Map(state.books.map((book) => [book.id, book]));
  state.books = next.markets.map((id) => {
    const book = newBook(id, slice, fixedStrategy(next));
    const old = previous.get(id);
    if (old) {
      book.lastPrice = old.lastPrice;
      book.lastPriceT = old.lastPriceT;
      if (old.validation?.interval === next.interval) {
        book.validation = old.validation;
        if (next.strategy === "auto") book.strategy = old.validation.chosen;
      }
    }
    return book;
  });
  addLog(state, now, null, `Ajustes aplicados. ${next.markets.length} mercados, velas de ${next.interval}, capital repartido: ${slice.toFixed(2)} US$ cada uno.`);
}

export function closeMarket(state: BotState, id: string, now: number): string | null {
  const book = state.books.find((item) => item.id === id);
  if (!book) return "Ese mercado no está en el bot.";
  if (!book.sleeve.position) return "No hay posición abierta en ese mercado.";
  const price = book.lastPrice ?? book.sleeve.position.entryPrice;
  const trade = flatten(book.sleeve, price, now, costsOf(state.settings));
  if (trade) recordEvents(state, book, [{ type: "sell", trade }], book.strategy);
  return null;
}

export function setHalt(state: BotState, active: boolean, now: number): void {
  state.halt.manual = active;
  if (!active) {
    state.halt.daily = false;
    state.halt.drawdown = false;
    state.peakEquity = accountEquity(state);
    state.halt.dayStartEquity = state.peakEquity;
  }
  addLog(state, now, null, active ? "Pausa manual: sin entradas nuevas." : "Bot reanudado.", active ? "warn" : "info");
  markAccount(state, now);
}

export function barMs(state: BotState): number {
  return INTERVAL_MS[state.settings.interval];
}
