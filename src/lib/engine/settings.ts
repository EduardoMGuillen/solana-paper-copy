import type { RiskSettings } from "./types";

export const defaultSettings: RiskSettings = {
  fraction: 0.02,
  fractionCap: 0.05,
  minSol: 0.05,
  maxSignalAgeMs: 20_000,
  maxPriceDriftBps: 150,
  leaderCapitalCapSol: 3,
  leaderDrawdownPause: 0.2,
  mintCooldownMs: 12_000,
  blocklist: [],
  /** Five percent of the 100 US$ book. The old 0.50 limit belonged to a 10-unit book. */
  dailyLossKillSol: 5,
  protectiveStopPct: 0.15,
  feeBps: 10,
  slippageBps: 30,
};

function num(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function clampSettings(input: Partial<RiskSettings> | null | undefined): RiskSettings {
  const source = input ?? {};
  const blocklist = Array.isArray(source.blocklist)
    ? [
        ...new Set(
          source.blocklist
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ].slice(0, 40)
    : [];

  return {
    fraction: num(source.fraction, defaultSettings.fraction, 0.001, 0.25),
    fractionCap: num(source.fractionCap, defaultSettings.fractionCap, 0.001, 0.5),
    minSol: num(source.minSol, defaultSettings.minSol, 0, 5),
    maxSignalAgeMs: num(source.maxSignalAgeMs, defaultSettings.maxSignalAgeMs, 1_000, 120_000),
    maxPriceDriftBps: num(source.maxPriceDriftBps, defaultSettings.maxPriceDriftBps, 1, 2_000),
    leaderCapitalCapSol: num(
      source.leaderCapitalCapSol,
      defaultSettings.leaderCapitalCapSol,
      0.05,
      100,
    ),
    leaderDrawdownPause: num(
      source.leaderDrawdownPause,
      defaultSettings.leaderDrawdownPause,
      0.05,
      0.9,
    ),
    mintCooldownMs: num(source.mintCooldownMs, defaultSettings.mintCooldownMs, 0, 86_400_000),
    blocklist,
    dailyLossKillSol: num(source.dailyLossKillSol, defaultSettings.dailyLossKillSol, 0.01, 100),
    protectiveStopPct: num(
      source.protectiveStopPct,
      defaultSettings.protectiveStopPct,
      0.01,
      0.9,
    ),
    feeBps: num(source.feeBps, defaultSettings.feeBps, 0, 500),
    slippageBps: num(source.slippageBps, defaultSettings.slippageBps, 0, 500),
  };
}
