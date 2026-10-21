import { DECODER_SHAPE } from "./bidask";
import { DECODER_EXITS, DECODER_RULES, forwardTest, summarize, type ExitRules, type LpTrade, type PoolSnap } from "./meteora";

/**
 * Daily candles and fee buckets from the DLMM Data API, joined into the same
 * `PoolSnap` series the forward test already walks. TVL is the pool's TVL
 * today: the history endpoints do not return it.
 */

export type HistoryCandle = { timestamp: number; close: number };
export type VolumeBucket = { timestamp: number; volume: number; fees: number };

export type PoolMeta = {
  address: string;
  name: string;
  /** True when the quote mint is SOL, so the candle close is already SOL per token. */
  solIsY: boolean;
  tvl: number;
  binStep: number;
  baseFeePct: number;
};

const DAY = 86_400;

function dayKey(timestamp: number): number {
  return Math.floor(timestamp / DAY);
}

/**
 * One snapshot per candle that has a matching fee bucket. `fees1h` is the
 * day's fees spread over 24 hours so `simulateLp` (which multiplies by the
 * hours between snapshots) still credits one day's fees once.
 */
/**
 * Meteora lists several pools per token. Keep the address whose latest snap
 * pays more fees per TVL, so the same name is not counted twice.
 */
export function keepOnePoolPerName(snaps: PoolSnap[]): PoolSnap[] {
  const best = new Map<string, { address: string; t: number; score: number }>();
  for (const snap of snaps) {
    const score = snap.tvl > 0 ? snap.fees24h / snap.tvl : 0;
    const current = best.get(snap.name);
    if (!current || snap.t > current.t || (snap.t === current.t && score > current.score)) {
      best.set(snap.name, { address: snap.address, t: snap.t, score });
    }
  }
  const addresses = new Set([...best.values()].map((row) => row.address));
  return snaps.filter((snap) => addresses.has(snap.address));
}

export function historySnaps(meta: PoolMeta, candles: HistoryCandle[], volumes: VolumeBucket[]): PoolSnap[] {
  const byExact = new Map<number, VolumeBucket>();
  const byDay = new Map<number, VolumeBucket>();
  for (const bucket of volumes) {
    byExact.set(bucket.timestamp, bucket);
    byDay.set(dayKey(bucket.timestamp), bucket);
  }
  const snaps: PoolSnap[] = [];
  for (const candle of candles) {
    const bucket = byExact.get(candle.timestamp) ?? byDay.get(dayKey(candle.timestamp));
    if (!bucket || !(meta.tvl > 0)) continue;
    const price = meta.solIsY ? candle.close : candle.close > 0 ? 1 / candle.close : Number.NaN;
    if (!(price > 0) || !Number.isFinite(bucket.fees) || !Number.isFinite(bucket.volume)) continue;
    snaps.push({
      t: candle.timestamp * 1000,
      address: meta.address,
      name: meta.name,
      price,
      tvl: meta.tvl,
      binStep: meta.binStep,
      baseFeePct: meta.baseFeePct,
      fees1h: bucket.fees / 24,
      fees24h: bucket.fees,
      volume1h: bucket.volume / 24,
      volume24h: bucket.volume,
    });
  }
  snaps.sort((a, b) => a.t - b.t);
  return snaps;
}

export type ScenarioId = "decoder" | "stop" | "hold";

export type ScenarioSummary = {
  id: ScenarioId;
  label: string;
  trades: number;
  winRate: number;
  mean: number;
  median: number;
  worst: number;
  crashRate: number;
  meanFees: number;
  /** Sum of per-position returns. Positions overlap, so this is not a portfolio return. */
  sum: number;
};

export type TradeRow = {
  address: string;
  name: string;
  entryT: number;
  exitT: number;
  minRatio: number;
  exitRatio: number;
  fees: number;
  mark: number;
  result: number;
  reason: LpTrade["reason"];
};

export type PoolRollup = {
  address: string;
  name: string;
  trades: number;
  winRate: number;
  mean: number;
  worst: number;
  sum: number;
};

export type MeteoraView = {
  generatedAt: number;
  windowDays: number;
  from: number | null;
  to: number | null;
  poolsSeen: number;
  poolsWithHistory: number;
  failed: number;
  snaps: number;
  scenarios: ScenarioSummary[];
  trades: TradeRow[];
  pools: PoolRollup[];
  curve: { t: number; sum: number }[];
};

const SCENARIOS: { id: ScenarioId; label: string; exits: ExitRules }[] = [
  { id: "decoder", label: "Decoder · +8% / −20% / 24 h", exits: DECODER_EXITS },
  { id: "stop", label: "Stop corto · +8% / −10% / 24 h", exits: { ...DECODER_EXITS, stopLoss: 0.1 } },
  { id: "hold", label: "Aguante · +8% / −20% / 72 h", exits: { ...DECODER_EXITS, holdHours: 72 } },
];

function summarizeScenario(id: ScenarioId, label: string, trades: LpTrade[]): ScenarioSummary {
  const report = summarize(trades);
  const n = trades.length;
  return {
    id,
    label,
    trades: n,
    winRate: report.winRate,
    mean: report.mean,
    median: report.median,
    worst: report.worst,
    crashRate: report.crashRate,
    meanFees: n ? trades.reduce((sum, trade) => sum + trade.fees, 0) / n : 0,
    sum: trades.reduce((sum, trade) => sum + trade.result, 0),
  };
}

function toRow(trade: LpTrade): TradeRow {
  return {
    address: trade.address,
    name: trade.name,
    entryT: trade.entryT,
    exitT: trade.exitT,
    minRatio: trade.minRatio,
    exitRatio: trade.exitRatio,
    fees: trade.fees,
    mark: trade.mark,
    result: trade.result,
    reason: trade.reason,
  };
}

function rollup(trades: LpTrade[]): PoolRollup[] {
  const byPool = new Map<string, LpTrade[]>();
  for (const trade of trades) {
    const list = byPool.get(trade.address) ?? [];
    list.push(trade);
    byPool.set(trade.address, list);
  }
  return [...byPool.entries()]
    .map(([address, rows]) => {
      const results = rows.map((trade) => trade.result).sort((a, b) => a - b);
      const n = rows.length;
      return {
        address,
        name: rows[0].name,
        trades: n,
        winRate: rows.filter((trade) => trade.result > 0).length / n,
        mean: results.reduce((sum, value) => sum + value, 0) / n,
        worst: results[0],
        sum: results.reduce((sum, value) => sum + value, 0),
      };
    })
    .sort((a, b) => a.mean - b.mean);
}

/** The three exit rules from the research CLI, on one collected series. */
export function assembleReport(input: {
  now: number;
  windowDays: number;
  poolsSeen: number;
  poolsWithHistory: number;
  failed: number;
  snaps: PoolSnap[];
}): MeteoraView {
  const snaps = keepOnePoolPerName(input.snaps);
  const times = snaps.map((snap) => snap.t).sort((a, b) => a - b);
  const scenarios = SCENARIOS.map((scenario) => {
    const trades = forwardTest(snaps, DECODER_RULES, DECODER_SHAPE, scenario.exits).trades;
    return { scenario, trades };
  });
  const primary = scenarios[0].trades;
  const ordered = [...primary].sort((a, b) => a.exitT - b.exitT || a.address.localeCompare(b.address));
  let sum = 0;
  const curve = ordered.map((trade) => {
    sum += trade.result;
    return { t: trade.exitT, sum };
  });
  return {
    generatedAt: input.now,
    windowDays: input.windowDays,
    from: times[0] ?? null,
    to: times.at(-1) ?? null,
    poolsSeen: input.poolsSeen,
    poolsWithHistory: input.poolsWithHistory,
    failed: input.failed,
    snaps: snaps.length,
    scenarios: scenarios.map(({ scenario, trades }) => summarizeScenario(scenario.id, scenario.label, trades)),
    trades: [...primary].sort((a, b) => b.exitT - a.exitT || a.name.localeCompare(b.name)).map(toRow),
    pools: rollup(primary),
    curve,
  };
}
