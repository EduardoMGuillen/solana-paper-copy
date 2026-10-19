import { MARKETS, type Interval } from "./market";
import { isStrategyId, type StrategyId } from "./strategies";

export type BotSettings = {
  interval: Interval;
  /** Markets traded, each with an equal slice of capital. */
  markets: string[];
  /** "auto" trades, per market, the best strategy that passes walk-forward. */
  strategy: StrategyId | "auto";
  /** Fraction of the sleeve lost if the initial stop is hit. */
  riskPerTrade: number;
  /** Max fraction of a sleeve in its position. 1 = no leverage. */
  maxExposure: number;
  /** Stop new entries after this fraction of drawdown from the account peak. */
  maxDrawdownHalt: number;
  /** Stop new entries for the day after this realized loss (fraction of equity). */
  dailyLossHalt: number;
  feeBps: number;
  slippageBps: number;
};

export const defaultBotSettings: BotSettings = {
  interval: "4h",
  markets: ["SOL", "BTC", "ETH", "JUP", "WIF"],
  strategy: "auto",
  riskPerTrade: 0.02,
  maxExposure: 1,
  maxDrawdownHalt: 0.2,
  dailyLossHalt: 0.05,
  feeBps: 10,
  slippageBps: 10,
};

function num(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function clampBotSettings(input: Partial<BotSettings> | null | undefined): BotSettings {
  const source = input ?? {};
  const known = new Set(MARKETS.map((market) => market.id));
  const markets = Array.isArray(source.markets)
    ? [...new Set(source.markets.filter((id): id is string => typeof id === "string" && known.has(id)))]
    : defaultBotSettings.markets;
  const interval: Interval =
    source.interval === "1h" || source.interval === "4h" || source.interval === "1d"
      ? source.interval
      : defaultBotSettings.interval;
  return {
    interval,
    markets: markets.length > 0 ? markets : defaultBotSettings.markets,
    strategy:
      source.strategy === "auto" || isStrategyId(source.strategy) ? source.strategy : defaultBotSettings.strategy,
    riskPerTrade: num(source.riskPerTrade, defaultBotSettings.riskPerTrade, 0.001, 0.05),
    maxExposure: num(source.maxExposure, defaultBotSettings.maxExposure, 0.1, 1),
    maxDrawdownHalt: num(source.maxDrawdownHalt, defaultBotSettings.maxDrawdownHalt, 0.05, 0.6),
    dailyLossHalt: num(source.dailyLossHalt, defaultBotSettings.dailyLossHalt, 0.01, 0.3),
    feeBps: num(source.feeBps, defaultBotSettings.feeBps, 0, 200),
    slippageBps: num(source.slippageBps, defaultBotSettings.slippageBps, 0, 200),
  };
}
