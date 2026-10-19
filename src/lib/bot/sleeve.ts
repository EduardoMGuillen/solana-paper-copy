import type { Candle } from "./indicators";
import type { Indicators, OpenTrade, Strategy } from "./strategies";

/**
 * One market traded by one strategy with its own slice of capital.
 * The same bar-by-bar step drives both the backtest and the live paper bot,
 * so live paper results are directly comparable to the backtest.
 *
 * Timing on bar i:
 *   1. fill the order decided at the close of bar i-1 at bar i's open
 *   2. check the stop against bar i's low (gap below the stop fills at the open)
 *   3. decide on bar i's close; the order fills at bar i+1's open
 */

export type Costs = {
  feeBps: number;
  slippageBps: number;
};

export type SizingRules = {
  /** Fraction of sleeve equity lost if the initial stop is hit. */
  riskPerTrade: number;
  /** Max fraction of sleeve equity in the position. 1 = no leverage. */
  maxExposure: number;
};

export type ExitReason = "senal" | "stop" | "cierre";

export type ClosedTrade = {
  entryT: number;
  exitT: number;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  /** Net of fees on both sides. */
  pnl: number;
  /** pnl divided by the dollar risk at entry. */
  r: number;
  fees: number;
  bars: number;
  reason: ExitReason;
  note: string;
};

export type Pending =
  | { kind: "buy"; stop: number; note: string; decidedT: number }
  | { kind: "sell"; note: string; decidedT: number };

export type SleevePosition = OpenTrade & {
  qty: number;
  /** Cash spent including the entry fee. */
  cost: number;
  riskUsd: number;
  note: string;
};

export type Sleeve = {
  cash: number;
  position: SleevePosition | null;
  pending: Pending | null;
  trades: ClosedTrade[];
  /** Open time of the last fully processed (closed) bar. */
  lastT: number | null;
};

export function newSleeve(capital: number): Sleeve {
  return { cash: capital, position: null, pending: null, trades: [], lastT: null };
}

export function sleeveEquity(sleeve: Sleeve, mark: number, costs: Costs): number {
  if (!sleeve.position) return sleeve.cash;
  const px = mark * (1 - costs.slippageBps / 10_000);
  const gross = sleeve.position.qty * px;
  return sleeve.cash + gross - gross * (costs.feeBps / 10_000);
}

function sell(
  sleeve: Sleeve,
  rawPrice: number,
  t: number,
  reason: ExitReason,
  note: string,
  costs: Costs,
): ClosedTrade | null {
  const position = sleeve.position;
  if (!position) return null;
  const price = rawPrice * (1 - costs.slippageBps / 10_000);
  const gross = position.qty * price;
  const fee = gross * (costs.feeBps / 10_000);
  const proceeds = gross - fee;
  const pnl = proceeds - position.cost;
  const trade: ClosedTrade = {
    entryT: position.entryT,
    exitT: t,
    entryPrice: position.entryPrice,
    exitPrice: price,
    qty: position.qty,
    pnl,
    r: position.riskUsd > 0 ? pnl / position.riskUsd : 0,
    fees: fee + (position.cost - position.qty * position.entryPrice),
    bars: position.barsHeld,
    reason,
    note,
  };
  sleeve.cash += proceeds;
  sleeve.position = null;
  sleeve.trades.push(trade);
  return trade;
}

function buy(
  sleeve: Sleeve,
  rawPrice: number,
  stop: number,
  t: number,
  note: string,
  costs: Costs,
  sizing: SizingRules,
): boolean {
  const price = rawPrice * (1 + costs.slippageBps / 10_000);
  // A gap through the planned stop means the setup is already broken.
  if (!(price > stop) || !(stop > 0)) return false;
  const equity = sleeve.cash;
  const feeRate = costs.feeBps / 10_000;
  const perUnitRisk = price - stop;
  let qty = (equity * sizing.riskPerTrade) / perUnitRisk;
  qty = Math.min(qty, (equity * sizing.maxExposure) / price);
  qty = Math.min(qty, sleeve.cash / (price * (1 + feeRate)));
  if (!(qty > 0) || qty * price < 1) return false;
  const cost = qty * price * (1 + feeRate);
  sleeve.cash = Math.max(0, sleeve.cash - cost);
  sleeve.position = {
    barsHeld: 0,
    entryPrice: price,
    entryT: t,
    stop,
    peak: price,
    qty,
    cost,
    riskUsd: qty * perUnitRisk,
    note,
  };
  return true;
}

export type StepEvent =
  | { type: "buy"; t: number; price: number; note: string }
  | { type: "sell"; trade: ClosedTrade };

/** Fill a pending order at a bar's open. Safe to call on a still-forming bar. */
export function fillAtOpen(
  sleeve: Sleeve,
  bar: Candle,
  costs: Costs,
  sizing: SizingRules,
  allowEntries: boolean,
): StepEvent[] {
  const pending = sleeve.pending;
  if (!pending) return [];
  if (bar.t <= pending.decidedT) return [];
  sleeve.pending = null;
  if (pending.kind === "sell") {
    const trade = sell(sleeve, bar.o, bar.t, "senal", pending.note, costs);
    return trade ? [{ type: "sell", trade }] : [];
  }
  if (!allowEntries || sleeve.position) return [];
  return buy(sleeve, bar.o, pending.stop, bar.t, pending.note, costs, sizing)
    ? [{ type: "buy", t: bar.t, price: sleeve.position!.entryPrice, note: pending.note }]
    : [];
}

/** Process a CLOSED bar: open fill, stop check, then the close decision. */
export function stepBar(
  sleeve: Sleeve,
  strategy: Strategy,
  ind: Indicators,
  i: number,
  costs: Costs,
  sizing: SizingRules,
  allowEntries = true,
): StepEvent[] {
  const bar = ind.candles[i];
  if (sleeve.lastT !== null && bar.t <= sleeve.lastT) return [];
  const events = fillAtOpen(sleeve, bar, costs, sizing, allowEntries);

  const position = sleeve.position;
  if (position) {
    if (bar.l <= position.stop) {
      const fill = Math.min(bar.o, position.stop);
      const trade = sell(sleeve, fill, bar.t, "stop", "Stop alcanzado", costs);
      if (trade) events.push({ type: "sell", trade });
    } else {
      position.peak = Math.max(position.peak, bar.h);
      position.barsHeld += 1;
    }
  }

  if (i >= strategy.warmup) {
    if (sleeve.position) {
      const decision = strategy.manage(ind, i, sleeve.position);
      sleeve.position.stop = Math.max(sleeve.position.stop, decision.stop);
      if (decision.exit) {
        sleeve.pending = { kind: "sell", note: decision.note ?? "Señal de salida", decidedT: bar.t };
      }
    } else if (allowEntries) {
      const signal = strategy.entry(ind, i);
      if (signal) sleeve.pending = { kind: "buy", stop: signal.stop, note: signal.note, decidedT: bar.t };
    }
  }

  sleeve.lastT = bar.t;
  return events;
}

/** Live only: stop out inside a still-forming bar when the last price breaks the stop. */
export function stopAtPrice(sleeve: Sleeve, price: number, t: number, costs: Costs): ClosedTrade | null {
  if (!sleeve.position || !(price <= sleeve.position.stop)) return null;
  if (sleeve.pending?.kind === "sell") sleeve.pending = null;
  return sell(sleeve, price, t, "stop", "Stop alcanzado", costs);
}

/** Close the open position at a given price (manual close or reallocation). */
export function flatten(sleeve: Sleeve, price: number, t: number, costs: Costs, note = "Cierre manual"): ClosedTrade | null {
  sleeve.pending = null;
  return sell(sleeve, price, t, "cierre", note, costs);
}
