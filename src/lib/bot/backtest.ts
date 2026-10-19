import type { Candle } from "./indicators";
import { newSleeve, sleeveEquity, stepBar, type ClosedTrade, type Costs, type SizingRules } from "./sleeve";
import { computeIndicators, STRATEGIES, type StrategyId } from "./strategies";

export type Metrics = {
  startEquity: number;
  endEquity: number;
  totalReturn: number;
  /** Annualized. Null when the window is too short to be meaningful. */
  cagr: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdown: number;
  trades: number;
  winRate: number | null;
  profitFactor: number | null;
  /** Average R multiple per trade (net). */
  expectancyR: number | null;
  avgBars: number | null;
  /** Fraction of bars spent in a position. */
  exposure: number;
  buyHoldReturn: number;
  buyHoldMaxDrawdown: number;
  fromT: number;
  toT: number;
};

export type BacktestResult = {
  strategy: StrategyId;
  metrics: Metrics;
  trades: ClosedTrade[];
  equity: { t: number; equity: number }[];
};

const YEAR_MS = 365 * 24 * 3_600_000;

function maxDrawdownOf(values: number[]): number {
  let peak = Number.NEGATIVE_INFINITY;
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) worst = Math.max(worst, (peak - value) / peak);
  }
  return worst;
}

export function computeMetrics(
  equity: { t: number; equity: number }[],
  trades: ClosedTrade[],
  closes: number[],
  inPositionBars: number,
): Metrics {
  const values = equity.map((point) => point.equity);
  const start = values[0] ?? 0;
  const end = values[values.length - 1] ?? start;
  const fromT = equity[0]?.t ?? 0;
  const toT = equity[equity.length - 1]?.t ?? fromT;
  const span = toT - fromT;
  const barMs = equity.length > 1 ? span / (equity.length - 1) : 0;
  const barsPerYear = barMs > 0 ? YEAR_MS / barMs : 0;

  const returns: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i - 1] > 0) returns.push(values[i] / values[i - 1] - 1);
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / (returns.length || 1);
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  const downside =
    returns.reduce((sum, value) => sum + Math.min(0, value) ** 2, 0) / Math.max(1, returns.length - 1);
  const annual = Math.sqrt(barsPerYear);

  const wins = trades.filter((trade) => trade.pnl > 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = trades.filter((trade) => trade.pnl <= 0).reduce((sum, trade) => sum - trade.pnl, 0);

  const firstClose = closes[0] ?? 0;
  const lastClose = closes[closes.length - 1] ?? firstClose;

  return {
    startEquity: start,
    endEquity: end,
    totalReturn: start > 0 ? end / start - 1 : 0,
    cagr: span >= YEAR_MS / 12 && start > 0 && end > 0 ? (end / start) ** (YEAR_MS / span) - 1 : null,
    sharpe: variance > 0 && returns.length > 30 ? (mean / Math.sqrt(variance)) * annual : null,
    sortino: downside > 0 && returns.length > 30 ? (mean / Math.sqrt(downside)) * annual : null,
    maxDrawdown: maxDrawdownOf(values),
    trades: trades.length,
    winRate: trades.length > 0 ? wins.length / trades.length : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null,
    expectancyR: trades.length > 0 ? trades.reduce((sum, trade) => sum + trade.r, 0) / trades.length : null,
    avgBars: trades.length > 0 ? trades.reduce((sum, trade) => sum + trade.bars, 0) / trades.length : null,
    exposure: equity.length > 0 ? inPositionBars / equity.length : 0,
    buyHoldReturn: firstClose > 0 ? lastClose / firstClose - 1 : 0,
    buyHoldMaxDrawdown: maxDrawdownOf(closes),
    fromT,
    toT,
  };
}

export type BacktestOptions = {
  capital: number;
  costs: Costs;
  sizing: SizingRules;
  /** First bar index allowed to trade. Earlier bars only warm up indicators. */
  tradeFrom?: number;
  /** Last bar index (inclusive). */
  tradeTo?: number;
};

export function runBacktest(candles: Candle[], strategyId: StrategyId, options: BacktestOptions): BacktestResult {
  const strategy = STRATEGIES[strategyId];
  const ind = computeIndicators(candles);
  const sleeve = newSleeve(options.capital);
  const from = Math.max(1, options.tradeFrom ?? strategy.warmup);
  const to = Math.min(candles.length - 1, options.tradeTo ?? candles.length - 1);
  const equity: { t: number; equity: number }[] = [];
  const closes: number[] = [];
  let inPosition = 0;

  for (let i = from; i <= to; i += 1) {
    stepBar(sleeve, strategy, ind, i, options.costs, options.sizing);
    if (sleeve.position) inPosition += 1;
    equity.push({ t: candles[i].t, equity: sleeveEquity(sleeve, candles[i].c, options.costs) });
    closes.push(candles[i].c);
  }

  return {
    strategy: strategyId,
    metrics: computeMetrics(equity, sleeve.trades, closes, inPosition),
    trades: sleeve.trades,
    equity,
  };
}

export type WalkForward = {
  strategy: StrategyId;
  full: BacktestResult;
  inSample: Metrics;
  outOfSample: Metrics;
  /** A simple pass/fail gate before any capital is trusted to the strategy. */
  verdict: { pass: boolean; reasons: string[] };
};

/**
 * Split history: the first 70% is in-sample, the last 30% out-of-sample.
 * The parameters were chosen up front, so the OOS block is an honest
 * estimate of what the strategy does on data it was never fitted to.
 */
export function walkForward(
  candles: Candle[],
  strategyId: StrategyId,
  options: BacktestOptions,
  split = 0.7,
  maxDrawdown = 0.25,
): WalkForward {
  const warmup = STRATEGIES[strategyId].warmup;
  const cut = Math.max(warmup + 50, Math.floor(warmup + (candles.length - warmup) * split));
  const full = runBacktest(candles, strategyId, options);
  const inSample = runBacktest(candles, strategyId, { ...options, tradeTo: cut - 1 }).metrics;
  const outOfSample = runBacktest(candles, strategyId, { ...options, tradeFrom: cut }).metrics;
  return { strategy: strategyId, full, inSample, outOfSample, verdict: judge(full.metrics, outOfSample, maxDrawdown) };
}

export function judge(full: Metrics, oos: Metrics, maxDrawdown = 0.25): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (full.trades < 20) reasons.push(`Solo ${full.trades} operaciones: muestra pequeña`);
  if (!(full.profitFactor !== null && full.profitFactor >= 1.2)) reasons.push("Factor de beneficio < 1,2");
  if (!(oos.totalReturn > 0)) reasons.push("Pierde fuera de muestra");
  if (full.maxDrawdown > maxDrawdown) reasons.push(`Drawdown máximo > ${(maxDrawdown * 100).toFixed(0)}%`);
  if (!(full.expectancyR !== null && full.expectancyR > 0.1)) reasons.push("Expectativa < 0,1 R por operación");
  return { pass: reasons.length === 0, reasons };
}
