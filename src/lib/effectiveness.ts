import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { STARTING_USD } from "./engine/constants";
import { markEquity } from "./engine/engine";
import type { EngineState, Trade, TradeReason } from "./engine/types";
import { dataDir } from "./paths";

export type SessionRecord = {
  id: string;
  pid: number;
  start: number;
  stop: number | null;
};

export type DatasetTrade = {
  id: string;
  leader: string;
  mint: string;
  symbol: string;
  side: "buy" | "sell";
  entry: number | null;
  exit: number | null;
  size: number;
  fees: number;
  slippage: number;
  pnl: number | null;
  reason: TradeReason;
  timestamps: {
    ts: number;
    openedAt: number | null;
    closedAt: number | null;
  };
};

export type EffectivenessDataset = {
  version: 1;
  currency: "USD";
  path: "data/effectiveness.json";
  startingEquity: number;
  accountCreatedAt: number;
  sessions: SessionRecord[];
  trades: DatasetTrade[];
  equityCurve: { t: number; equity: number }[];
  drawdownCurve: { t: number; drawdown: number }[];
  winRate: number | null;
  profitFactor: number | null;
  profitFactorUnbounded: boolean;
  maxDrawdown: number;
  totalReturn: number;
  equity: number;
  closed: number;
  updatedAt: number;
};

const CURVE_CAP = 2_000;
const TRADE_CAP = 5_000;

const g = globalThis as { __paperSessionId?: string };

export function datasetFile(): string {
  return path.join(dataDir(), "effectiveness.json");
}

export function emptyDataset(now: number): EffectivenessDataset {
  return {
    version: 1,
    currency: "USD",
    path: "data/effectiveness.json",
    startingEquity: STARTING_USD,
    accountCreatedAt: now,
    sessions: [],
    trades: [],
    equityCurve: [],
    drawdownCurve: [],
    winRate: null,
    profitFactor: null,
    profitFactorUnbounded: false,
    maxDrawdown: 0,
    totalReturn: 0,
    equity: STARTING_USD,
    closed: 0,
    updatedAt: now,
  };
}

function sessionId(now: number): string {
  if (!g.__paperSessionId) g.__paperSessionId = `sesion-${process.pid}-${now}`;
  return g.__paperSessionId;
}

function mergeByTime<T extends { t: number }>(previous: T[], next: T[], cap: number): T[] {
  const byTime = new Map<number, T>();
  for (const point of previous) byTime.set(point.t, point);
  for (const point of next) byTime.set(point.t, point);
  return [...byTime.values()].sort((a, b) => a.t - b.t).slice(-cap);
}

function toDatasetTrade(state: EngineState, trade: Trade): DatasetTrade {
  const leader = state.leaders.find((item) => item.id === trade.leaderId);
  return {
    id: trade.id,
    leader: leader?.name ?? trade.leaderId,
    mint: trade.mint,
    symbol: trade.symbol,
    side: trade.side,
    entry: trade.entry,
    exit: trade.exit,
    size: trade.notionalSol,
    fees: trade.feeSol,
    slippage: trade.slippage,
    pnl: trade.pnlSol,
    reason: trade.reason,
    timestamps: {
      ts: trade.ts,
      openedAt: trade.openedAt,
      closedAt: trade.closedAt,
    },
  };
}

export function assembleDataset(input: {
  state: EngineState;
  previous: EffectivenessDataset | null;
  now: number;
  pid: number;
  sessionId: string;
  closing: boolean;
  replace: boolean;
}): EffectivenessDataset {
  const sameAccount = input.previous?.accountCreatedAt === input.state.createdAt;
  const previous = input.replace || !sameAccount ? null : input.previous;
  const equity = markEquity(input.state);

  let sessions = (input.previous?.sessions ?? []).map((session) => {
    if (session.stop === null && session.pid !== input.pid) {
      return { ...session, stop: input.previous?.updatedAt ?? input.now };
    }
    return session;
  });
  const current = sessions.find((session) => session.id === input.sessionId);
  if (!current) {
    sessions.push({
      id: input.sessionId,
      pid: input.pid,
      start: input.now,
      stop: input.closing ? input.now : null,
    });
  } else if (input.closing) {
    sessions = sessions.map((session) =>
      session.id === input.sessionId ? { ...session, stop: input.now } : session,
    );
  }

  const trades = mergeTrades(
    previous?.trades ?? [],
    input.state.trades.map((trade) => toDatasetTrade(input.state, trade)),
  );
  const equityCurve = mergeByTime(previous?.equityCurve ?? [], input.state.equityCurve, CURVE_CAP);
  const drawdownCurve = mergeByTime(
    previous?.drawdownCurve ?? [],
    input.state.drawdownCurve,
    CURVE_CAP,
  );
  const closedTrades = trades.filter((trade) => trade.pnl !== null);
  const wins = closedTrades.filter((trade) => (trade.pnl ?? 0) >= 0).length;
  const grossProfit = closedTrades.reduce((sum, trade) => sum + Math.max(0, trade.pnl ?? 0), 0);
  const grossLoss = closedTrades.reduce((sum, trade) => sum + Math.max(0, -(trade.pnl ?? 0)), 0);
  const winRate = closedTrades.length > 0 ? wins / closedTrades.length : null;
  const profitFactorUnbounded = grossLoss <= 0 && grossProfit > 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;
  const maxDrawdown = drawdownCurve.reduce((max, point) => Math.max(max, point.drawdown), 0);
  const totalReturn = (equity - STARTING_USD) / STARTING_USD;

  return {
    version: 1,
    currency: "USD",
    path: "data/effectiveness.json",
    startingEquity: STARTING_USD,
    accountCreatedAt: input.state.createdAt,
    sessions,
    trades,
    equityCurve,
    drawdownCurve,
    winRate,
    profitFactor,
    profitFactorUnbounded,
    maxDrawdown,
    totalReturn,
    equity,
    closed: closedTrades.length,
    updatedAt: input.now,
  };
}

function mergeTrades(previous: DatasetTrade[], next: DatasetTrade[]): DatasetTrade[] {
  const byId = new Map<string, DatasetTrade>();
  for (const trade of previous) byId.set(trade.id, trade);
  for (const trade of next) byId.set(trade.id, trade);
  return [...byId.values()]
    .sort((a, b) => a.timestamps.ts - b.timestamps.ts || a.id.localeCompare(b.id))
    .slice(-TRADE_CAP);
}

export async function readDataset(): Promise<EffectivenessDataset | null> {
  try {
    const raw = await readFile(datasetFile(), "utf8");
    const parsed = JSON.parse(raw) as EffectivenessDataset;
    if (parsed.version !== 1 || !Array.isArray(parsed.trades) || !Array.isArray(parsed.sessions)) {
      return null;
    }
    parsed.equityCurve ??= [];
    parsed.drawdownCurve ??= [];
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && code !== "ENOENT") return null;
    return null;
  }
}

async function atomicWrite(dataset: EffectivenessDataset): Promise<EffectivenessDataset> {
  const file = datasetFile();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(dataset));
  await rename(tmp, file);
  const saved = await readDataset();
  if (!saved) throw new Error("El dataset de efectividad no quedó en disco.");
  return saved;
}

export async function writeEffectiveness(
  state: EngineState,
  options: { closing?: boolean; replace?: boolean } = {},
): Promise<EffectivenessDataset> {
  const now = Date.now();
  const dataset = assembleDataset({
    state,
    previous: await readDataset(),
    now,
    pid: process.pid,
    sessionId: sessionId(now),
    closing: Boolean(options.closing),
    replace: Boolean(options.replace),
  });
  return atomicWrite(dataset);
}
