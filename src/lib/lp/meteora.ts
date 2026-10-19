import { bidAskBins, bidAskValue, lowerEdge, type BidAskShape } from "./bidask";

/**
 * Meteora DLMM pool screening and a forward paper test of a Decoder-Farmer
 * style position (SOL-only Bid-Ask below the entry price).
 *
 * Field names follow the documented `GET https://dlmm-api.meteora.ag/pair/all`
 * pair object. Parsing is defensive: unknown or missing fields drop the pool
 * instead of crashing the collector.
 */

export const METEORA_API = process.env.METEORA_API_URL || "https://dlmm-api.meteora.ag";
export const WSOL = "So11111111111111111111111111111111111111112";

type Windowed = Partial<Record<"min_30" | "hour_1" | "hour_2" | "hour_4" | "hour_12" | "hour_24", number>>;

export type RawPair = {
  address?: string;
  name?: string;
  mint_x?: string;
  mint_y?: string;
  bin_step?: number;
  base_fee_percentage?: string | number;
  liquidity?: string | number;
  current_price?: number;
  fees_24h?: number;
  trade_volume_24h?: number;
  fee_tvl_ratio?: Windowed;
  fees?: Windowed;
  volume?: Windowed;
  hide?: boolean;
  is_blacklisted?: boolean;
};

/** Compact pool snapshot, one line of the collector's JSONL. */
export type PoolSnap = {
  t: number;
  address: string;
  name: string;
  /** Token price in SOL. */
  price: number;
  tvl: number;
  binStep: number;
  baseFeePct: number;
  fees1h: number;
  fees24h: number;
  volume1h: number;
  volume24h: number;
};

const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export function parsePairs(body: unknown): RawPair[] {
  if (Array.isArray(body)) return body as RawPair[];
  if (body && typeof body === "object") {
    for (const key of ["pairs", "data", "groups"]) {
      const inner = (body as Record<string, unknown>)[key];
      if (Array.isArray(inner)) return inner as RawPair[];
    }
  }
  return [];
}

/** SOL-quoted, visible pools only, normalized so price is SOL per token. */
export function toSnap(pair: RawPair, t: number): PoolSnap | null {
  if (pair.hide || pair.is_blacklisted || !pair.address) return null;
  const solIsY = pair.mint_y === WSOL;
  const solIsX = pair.mint_x === WSOL;
  if (!solIsX && !solIsY) return null;
  const raw = num(pair.current_price);
  const price = solIsY ? raw : 1 / raw;
  const snap: PoolSnap = {
    t,
    address: pair.address,
    name: pair.name ?? pair.address.slice(0, 6),
    price,
    tvl: num(pair.liquidity),
    binStep: num(pair.bin_step),
    baseFeePct: num(pair.base_fee_percentage),
    fees1h: num(pair.fees?.hour_1),
    fees24h: num(pair.fees_24h ?? pair.fees?.hour_24),
    volume1h: num(pair.volume?.hour_1),
    volume24h: num(pair.trade_volume_24h ?? pair.volume?.hour_24),
  };
  if (!(snap.price > 0) || !(snap.tvl > 0)) return null;
  return snap;
}

export type ScreenRules = {
  minTvl: number;
  minFees24h: number;
  /** Decoder Farmer skips pools under a 1% base fee. */
  minBaseFeePct: number;
  minVolume1h: number;
};

export const DECODER_RULES: ScreenRules = { minTvl: 10_000, minFees24h: 1_000, minBaseFeePct: 1, minVolume1h: 10_000 };

export function passes(snap: PoolSnap, rules: ScreenRules): boolean {
  return (
    snap.tvl >= rules.minTvl &&
    snap.fees24h >= rules.minFees24h &&
    snap.baseFeePct >= rules.minBaseFeePct &&
    (Number.isFinite(snap.volume1h) ? snap.volume1h >= rules.minVolume1h : true)
  );
}

/** 24h fees as a fraction of TVL: the headline "APR" of a pool, per day. */
export function feeTvl24h(snap: PoolSnap): number {
  return snap.fees24h / snap.tvl;
}

export type ExitRules = {
  holdHours: number;
  /** Close when the position is up this much (fees + mark). */
  takeProfit: number;
  /** Close when the position is down this much. */
  stopLoss: number;
};

export const DECODER_EXITS: ExitRules = { holdHours: 24, takeProfit: 0.08, stopLoss: 0.2 };

export type LpTrade = {
  address: string;
  name: string;
  entryT: number;
  exitT: number;
  /** Lowest price ratio seen while open. */
  minRatio: number;
  exitRatio: number;
  fees: number;
  mark: number;
  result: number;
  reason: "tiempo" | "take-profit" | "stop" | "fuera de rango";
};

/**
 * Walk forward through one pool's snapshots from `entry`. Fee income is an
 * optimistic estimate: while price is inside the position (below entry,
 * above the lower edge) the whole position earns the pool's average fee/TVL
 * rate. If the strategy loses even so, it loses for real.
 */
export function simulateLp(snaps: PoolSnap[], entry: number, shape: BidAskShape, exits: ExitRules): LpTrade | null {
  const start = snaps[entry];
  if (!start) return null;
  const bins = bidAskBins(shape);
  let fees = 0;
  let minRatio = 1;
  for (let i = entry + 1; i < snaps.length; i += 1) {
    const prev = snaps[i - 1];
    const snap = snaps[i];
    const ratio = snap.price / start.price;
    minRatio = Math.min(minRatio, ratio);
    const hours = (snap.t - prev.t) / 3_600_000;
    if (ratio < 1 && ratio > lowerEdge(shape) && Number.isFinite(snap.fees1h) && snap.tvl > 0) {
      fees += (snap.fees1h / snap.tvl) * hours;
    }
    const mark = bidAskValue(bins, ratio) - 1;
    const result = mark + fees;
    const done = (reason: LpTrade["reason"]): LpTrade => ({
      address: start.address,
      name: start.name,
      entryT: start.t,
      exitT: snap.t,
      minRatio,
      exitRatio: ratio,
      fees,
      mark,
      result,
      reason,
    });
    if (ratio <= lowerEdge(shape)) return done("fuera de rango");
    if (result >= exits.takeProfit) return done("take-profit");
    if (result <= -exits.stopLoss) return done("stop");
    if (snap.t - start.t >= exits.holdHours * 3_600_000) return done("tiempo");
  }
  return null;
}

export type LpReport = {
  trades: LpTrade[];
  winRate: number;
  mean: number;
  median: number;
  worst: number;
  /** Share of trades whose token fell more than 60% while the position was open. */
  crashRate: number;
};

export function summarize(trades: LpTrade[]): LpReport {
  const results = trades.map((trade) => trade.result).sort((a, b) => a - b);
  const n = results.length;
  return {
    trades,
    winRate: n ? trades.filter((trade) => trade.result > 0).length / n : 0,
    mean: n ? results.reduce((sum, value) => sum + value, 0) / n : 0,
    median: n ? results[Math.floor(n / 2)] : 0,
    worst: n ? results[0] : 0,
    crashRate: n ? trades.filter((trade) => trade.minRatio < 0.4).length / n : 0,
  };
}

/**
 * Forward test over collected snapshots: every time a pool passes the screen,
 * open one simulated position (at most one open per pool at a time).
 */
export function forwardTest(all: PoolSnap[], rules: ScreenRules, shape: BidAskShape, exits: ExitRules): LpReport {
  const byPool = new Map<string, PoolSnap[]>();
  for (const snap of all) {
    const list = byPool.get(snap.address) ?? [];
    list.push(snap);
    byPool.set(snap.address, list);
  }
  const trades: LpTrade[] = [];
  for (const snaps of byPool.values()) {
    snaps.sort((a, b) => a.t - b.t);
    let busyUntil = 0;
    for (let i = 0; i < snaps.length; i += 1) {
      if (snaps[i].t < busyUntil || !passes(snaps[i], rules)) continue;
      const trade = simulateLp(snaps, i, shape, exits);
      if (!trade) break; // not enough future data yet
      trades.push(trade);
      busyUntil = trade.exitT;
    }
  }
  return summarize(trades);
}
