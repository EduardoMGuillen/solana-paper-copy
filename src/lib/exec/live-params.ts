/**
 * Settings for the Meteora live bot. The dashboard can change them only while
 * the bot is stopped. Nothing here signs.
 */

export type LiveParams = {
  /** Share of the live wallet used for each new position. 0.1 = 10%. */
  slot: number;
  minTvl: number;
  minFees24h: number;
  /** Base fee in percent, same unit as the paper screen (1 = 1%). */
  minBaseFeePct: number;
  minVolume1h: number;
  /** Close when the position is up this fraction. */
  takeProfit: number;
  /** Close when the position is down this fraction. */
  stopLoss: number;
  holdHours: number;
  /** How far below entry the Bid-Ask range reaches. 0.75 = −75%. */
  range: number;
  /** Bin width as a fraction. 0.01 = 1%. */
  binStep: number;
  /** Skip pools created less than this many days ago. 0 = any age. */
  minAgeDays: number;
};

/** Decoder Farmer screen, exits and shape at 10% per position: the base every preset starts from. */
export const PAPER_LIVE_PARAMS: LiveParams = {
  slot: 0.1,
  minTvl: 10_000,
  minFees24h: 1_000,
  minBaseFeePct: 1,
  minVolume1h: 10_000,
  takeProfit: 0.08,
  stopLoss: 0.2,
  holdHours: 24,
  range: 0.75,
  binStep: 0.01,
  minAgeDays: 0,
};

/**
 * What a new wallet starts with. In an hourly backtest (Sep 26 – Oct 26 2026, 105 SOL pools,
 * fees credited only to liquidity in the bins price crossed), 25% per position instead of 10%
 * cut fixed costs per SOL, and it was the only tested setup that ended the month positive.
 */
export const DEFAULT_LIVE_PARAMS: LiveParams = { ...PAPER_LIVE_PARAMS, slot: 0.25 };

export type LivePreset = {
  id: string;
  name: string;
  blurb: string;
  params: LiveParams;
};

export const LIVE_PRESETS: LivePreset[] = [
  {
    id: "recomendado",
    name: "Recommended",
    blurb: "25% per position, Decoder filter, +8% / −20% / 24 h. One-month backtest: +5% to +7% with realistic fees, −2% to 0% with pessimistic ones. Worst position −21%.",
    params: DEFAULT_LIVE_PARAMS,
  },
  {
    id: "conservador",
    name: "Conservative",
    blurb: "Only pools 14+ days old with 50k+ TVL. Worst position −10%, but in the backtest the month closed at −2% to −4%.",
    params: { ...DEFAULT_LIVE_PARAMS, minTvl: 50_000, minFees24h: 2_000, minAgeDays: 14 },
  },
  {
    id: "agresivo",
    name: "Aggressive",
    blurb: "Lower filters, take profit +12%, stop −30%, 48 h. Backtest: +23% with realistic fees, +6% pessimistic, worst −8%. Caution: only 36 positions, and it enters small pools, the ones that sink the most.",
    params: {
      ...DEFAULT_LIVE_PARAMS,
      minTvl: 5_000,
      minFees24h: 500,
      minBaseFeePct: 0.5,
      minVolume1h: 5_000,
      takeProfit: 0.12,
      stopLoss: 0.3,
      holdHours: 48,
    },
  },
];

const BOUNDS: Record<keyof LiveParams, [number, number]> = {
  slot: [0.05, 1],
  minTvl: [0, 1_000_000],
  minFees24h: [0, 1_000_000],
  minBaseFeePct: [0.01, 10],
  minVolume1h: [0, 10_000_000],
  takeProfit: [0.02, 1],
  stopLoss: [0.05, 0.8],
  holdHours: [1, 168],
  range: [0.2, 0.9],
  binStep: [0.002, 0.05],
  minAgeDays: [0, 90],
};

export function sameLiveParams(a: LiveParams, b: LiveParams): boolean {
  return (Object.keys(BOUNDS) as (keyof LiveParams)[]).every((key) => a[key] === b[key]);
}

/** Keep each field inside its bound. Missing or broken fields stay on `base`. */
export function clampLiveParams(raw: unknown, base: LiveParams = DEFAULT_LIVE_PARAMS): LiveParams {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: LiveParams = { ...base };
  for (const key of Object.keys(BOUNDS) as (keyof LiveParams)[]) {
    const value = source[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (!Number.isFinite(parsed)) continue;
    const [min, max] = BOUNDS[key];
    const next = Math.min(max, Math.max(min, parsed));
    out[key] = key === "holdHours" || key === "minAgeDays" ? Math.round(next) : next;
  }
  return out;
}
