import { accountEquity, bookEquity, entriesAllowed, type BotState, type MarketBook } from "./engine";
import type { Candle } from "./indicators";
import { closedOnly, marketById } from "./market";
import { PROFILES, profileOf } from "./settings";
import { computeIndicators, STRATEGIES, STRATEGY_IDS, type Indicators, type StrategyId } from "./strategies";

const CHART_BARS = 120;

export type BotView = ReturnType<typeof toView>;

function last(values: number[]): number | null {
  const value = values[values.length - 1];
  return Number.isFinite(value) ? value : null;
}

/** Plain-language read of the chart, from closed bars only. */
function readChart(ind: Indicators): string[] {
  const i = ind.close.length - 1;
  if (i < 1) return [];
  const notes: string[] = [];
  const close = ind.close[i];
  const e20 = ind.ema20[i];
  const e50 = ind.ema50[i];
  const e200 = ind.ema200[i];
  if (Number.isFinite(e200)) {
    notes.push(close > e200 ? "Precio sobre la EMA 200: régimen alcista." : "Precio bajo la EMA 200: régimen bajista, no se compra.");
  }
  if (Number.isFinite(e20) && Number.isFinite(e50)) {
    notes.push(e20 > e50 ? "EMA 20 sobre EMA 50: impulso a favor." : "EMA 20 bajo EMA 50: impulso en contra.");
  }
  const a = ind.adx14[i];
  if (Number.isFinite(a)) notes.push(a > 25 ? `ADX ${a.toFixed(0)}: tendencia fuerte.` : a > 20 ? `ADX ${a.toFixed(0)}: tendencia moderada.` : `ADX ${a.toFixed(0)}: lateral, sin tendencia.`);
  const r = ind.rsi14[i];
  if (Number.isFinite(r)) notes.push(r > 70 ? `RSI ${r.toFixed(0)}: sobrecompra.` : r < 30 ? `RSI ${r.toFixed(0)}: sobreventa.` : `RSI ${r.toFixed(0)}: neutral.`);
  return notes;
}

function marketView(state: BotState, book: MarketBook, candles: Candle[] | undefined) {
  const market = marketById(book.id);
  const now = state.updatedAt;
  const closed = candles ? closedOnly(candles, state.settings.interval, now) : [];
  const ind = closed.length > 0 ? computeIndicators(closed) : null;
  const from = Math.max(0, closed.length - CHART_BARS);
  const chartFrom = closed[from]?.t ?? 0;
  const position = book.sleeve.position;
  const trades = state.trades.filter((trade) => trade.market === book.id);
  const realized = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const equity = bookEquity(state, book);

  const chart = ind
    ? closed.slice(from).map((bar, j) => ({
        ...bar,
        ema20: ind.ema20[from + j],
        ema50: ind.ema50[from + j],
        ema200: ind.ema200[from + j],
      }))
    : [];

  const markers = [
    ...trades.flatMap((trade) => [
      { t: trade.entryT, price: trade.entryPrice, side: "buy" as const },
      { t: trade.exitT, price: trade.exitPrice, side: "sell" as const },
    ]),
    ...(position ? [{ t: position.entryT, price: position.entryPrice, side: "buy" as const }] : []),
  ].filter((marker) => marker.t >= chartFrom);

  const strategy = book.strategy ? STRATEGIES[book.strategy] : null;
  const atrPct = ind && last(ind.atr14) !== null && last(ind.close) ? (last(ind.atr14)! / last(ind.close)!) : null;

  return {
    id: book.id,
    symbol: market?.symbol ?? book.id,
    strategy: book.strategy,
    strategyName: strategy?.name ?? null,
    strategySummary: strategy?.summary ?? null,
    lastPrice: book.lastPrice,
    lastPriceT: book.lastPriceT,
    error: book.error,
    equity,
    realized,
    trades: trades.length,
    wins: trades.filter((trade) => trade.pnl > 0).length,
    pending: book.sleeve.pending ? { kind: book.sleeve.pending.kind, note: book.sleeve.pending.note } : null,
    position: position
      ? {
          entryPrice: position.entryPrice,
          entryT: position.entryT,
          stop: position.stop,
          qty: position.qty,
          cost: position.cost,
          unrealized: equity - book.sleeve.cash - position.cost,
          note: position.note,
          barsHeld: position.barsHeld,
        }
      : null,
    indicators: ind
      ? {
          rsi14: last(ind.rsi14),
          adx14: last(ind.adx14),
          atrPct,
          ema20: last(ind.ema20),
          ema50: last(ind.ema50),
          ema200: last(ind.ema200),
          read: readChart(ind),
        }
      : null,
    chart,
    markers,
    validation: book.validation
      ? {
          at: book.validation.at,
          bars: book.validation.bars,
          chosen: book.validation.chosen,
          // The backtest curves stay server-side; the dashboard only shows the table.
          checks: book.validation.checks.map((check) => ({
            strategy: check.strategy,
            name: STRATEGIES[check.strategy].name,
            pass: check.pass,
            reasons: check.reasons,
            full: check.full,
            oosReturn: check.oosReturn,
          })),
        }
      : null,
  };
}

export function toView(state: BotState, candles: Map<string, Candle[]>) {
  const equity = accountEquity(state);
  const trades = [...state.trades];
  const wins = trades.filter((trade) => trade.pnl > 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = trades.filter((trade) => trade.pnl <= 0).reduce((sum, trade) => sum - trade.pnl, 0);
  let peak = state.startingEquity;
  let maxDrawdown = 0;
  const drawdownCurve = state.equityCurve.map((point) => {
    peak = Math.max(peak, point.equity);
    const drawdown = peak > 0 ? (peak - point.equity) / peak : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    return { t: point.t, drawdown };
  });

  return {
    now: state.updatedAt,
    createdAt: state.createdAt,
    disclaimer:
      "Cuenta en papel con precios reales. No firma ni envía transacciones. Resultados pasados no garantizan resultados futuros.",
    settings: state.settings,
    profile: profileOf(state.settings),
    profiles: Object.entries(PROFILES).map(([id, p]) => ({ id, name: p.name, summary: p.summary })),
    strategies: STRATEGY_IDS.map((id: StrategyId) => ({ id, name: STRATEGIES[id].name, summary: STRATEGIES[id].summary })),
    account: {
      equity,
      startingEquity: state.startingEquity,
      totalReturn: equity / state.startingEquity - 1,
      startingSol: state.startingSol,
      solPrice: state.solPrice,
      solPriceAtStart: state.solPriceAtStart,
      equitySol: state.solPrice > 0 ? equity / state.solPrice : null,
      /** Value today of just holding the starting SOL. */
      holdValue: state.startingSol * state.solPrice,
      realized: trades.reduce((sum, trade) => sum + trade.pnl, 0),
      open: state.books.filter((book) => book.sleeve.position).length,
      dayPnl: equity - state.halt.dayStartEquity,
      maxDrawdown,
      winRate: trades.length > 0 ? wins.length / trades.length : null,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null,
      expectancyR: trades.length > 0 ? trades.reduce((sum, trade) => sum + trade.r, 0) / trades.length : null,
      closed: trades.length,
    },
    halt: {
      active: !entriesAllowed(state),
      manual: state.halt.manual,
      reason: state.halt.reason,
    },
    equityCurve: state.equityCurve.slice(-300),
    drawdownCurve: drawdownCurve.slice(-300),
    markets: state.books.map((book) => marketView(state, book, candles.get(`${book.id}:${state.settings.interval}`))),
    trades: trades.reverse().slice(0, 40),
    log: [...state.log].reverse().slice(0, 40),
  };
}
