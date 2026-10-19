import { isInterval, MARKETS, type Interval } from "./market";
import { isStrategyId, type StrategyId } from "./strategies";

export type BotSettings = {
  /** Paper capital, in SOL. Applies on the next reset. */
  startingSol: number;
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

export type ProfileId = "conservador" | "agresivo";

/**
 * Both profiles trade the same validated long-only trend strategy on 4h
 * candles. Agresivo risks 5% of a market's capital per trade instead of 2%:
 * about twice the return and the drawdown in the backtest.
 */
export const PROFILES: Record<ProfileId, { name: string; summary: string; values: Partial<BotSettings> }> = {
  conservador: {
    name: "Conservador",
    summary: "2% de riesgo por operación. Backtest del portafolio: ~10% anual, caída máx. ~5%.",
    values: { riskPerTrade: 0.02, maxExposure: 1, dailyLossHalt: 0.05, maxDrawdownHalt: 0.2 },
  },
  agresivo: {
    name: "Agresivo",
    summary: "5% de riesgo por operación, hasta el 100% del capital del mercado. Backtest: ~20% anual, caída máx. ~7%. En vivo espera la mitad del retorno y el doble de caída.",
    values: { riskPerTrade: 0.05, maxExposure: 1, dailyLossHalt: 0.08, maxDrawdownHalt: 0.3 },
  },
};

export const defaultBotSettings: BotSettings = {
  startingSol: 1,
  interval: "4h",
  markets: ["SOL", "BTC", "ETH", "JUP", "WIF"],
  strategy: "auto",
  feeBps: 10,
  slippageBps: 10,
  ...(PROFILES.agresivo.values as Pick<BotSettings, "riskPerTrade" | "maxExposure" | "dailyLossHalt" | "maxDrawdownHalt">),
};

export function profileOf(settings: BotSettings): ProfileId | null {
  for (const [id, profile] of Object.entries(PROFILES) as [ProfileId, (typeof PROFILES)[ProfileId]][]) {
    const v = profile.values;
    if (
      v.riskPerTrade === settings.riskPerTrade &&
      v.maxExposure === settings.maxExposure &&
      v.dailyLossHalt === settings.dailyLossHalt &&
      v.maxDrawdownHalt === settings.maxDrawdownHalt
    ) {
      return id;
    }
  }
  return null;
}

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
  const interval: Interval = isInterval(source.interval) ? source.interval : defaultBotSettings.interval;
  return {
    startingSol: num(source.startingSol, defaultBotSettings.startingSol, 0.01, 10_000),
    interval,
    markets: markets.length > 0 ? markets : defaultBotSettings.markets,
    strategy:
      source.strategy === "auto" || isStrategyId(source.strategy) ? source.strategy : defaultBotSettings.strategy,
    riskPerTrade: num(source.riskPerTrade, defaultBotSettings.riskPerTrade, 0.001, 0.1),
    maxExposure: num(source.maxExposure, defaultBotSettings.maxExposure, 0.1, 1),
    maxDrawdownHalt: num(source.maxDrawdownHalt, defaultBotSettings.maxDrawdownHalt, 0.05, 0.6),
    dailyLossHalt: num(source.dailyLossHalt, defaultBotSettings.dailyLossHalt, 0.01, 0.3),
    feeBps: num(source.feeBps, defaultBotSettings.feeBps, 0, 200),
    slippageBps: num(source.slippageBps, defaultBotSettings.slippageBps, 0, 200),
  };
}
