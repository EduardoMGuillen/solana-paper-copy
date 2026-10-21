/**
 * Settings for the Meteora live window.
 * Defaults match the paper book. The dashboard can change them only while
 * that bot is stopped. Nothing here signs or touches the paper files.
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
};

/** What Meteora paper uses for a new position today. */
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
};

export type LivePreset = {
  id: string;
  name: string;
  blurb: string;
  params: LiveParams;
};

export const LIVE_PRESETS: LivePreset[] = [
  {
    id: "papel",
    name: "Papel",
    blurb: "10% por posición, +8% / −20% / 24 h. Es el libro de papel.",
    params: PAPER_LIVE_PARAMS,
  },
  {
    id: "activo",
    name: "Activo",
    blurb: "25% por posición. Los filtros y las salidas siguen siendo los del papel.",
    params: { ...PAPER_LIVE_PARAMS, slot: 0.25 },
  },
  {
    id: "agresivo",
    name: "Agresivo",
    blurb: "25% por posición, filtros más bajos, toma al +12%, stop al −30% y 48 h.",
    params: {
      ...PAPER_LIVE_PARAMS,
      slot: 0.25,
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
};

export function sameLiveParams(a: LiveParams, b: LiveParams): boolean {
  return (Object.keys(BOUNDS) as (keyof LiveParams)[]).every((key) => a[key] === b[key]);
}

/** Keep each field inside its bound. Missing or broken fields stay on `base`. */
export function clampLiveParams(raw: unknown, base: LiveParams = PAPER_LIVE_PARAMS): LiveParams {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: LiveParams = { ...base };
  for (const key of Object.keys(BOUNDS) as (keyof LiveParams)[]) {
    const value = source[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (!Number.isFinite(parsed)) continue;
    const [min, max] = BOUNDS[key];
    const next = Math.min(max, Math.max(min, parsed));
    out[key] = key === "holdHours" ? Math.round(next) : next;
  }
  return out;
}
