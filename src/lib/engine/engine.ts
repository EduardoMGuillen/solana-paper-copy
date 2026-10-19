import { evaluateCopy } from "./filters";
import {
  dayKey,
  drawdownPct,
  emptyStats,
  entryPrice,
  exitProceeds,
  feeSol,
} from "./money";
import { proportionalSellFraction } from "./exits";
import { stopTriggered } from "./exits";
import { STARTING_USD } from "./constants";
import { defaultSettings } from "./settings";
import type {
  EngineState,
  Leader,
  LeaderFill,
  MeteoraFeed,
  MeteoraWallet,
  Position,
  RiskSettings,
  TradeReason,
} from "./types";

const SERIES_CAP = 180;
const CURVE_CAP = 240;
const WALLET_BET_CAP = 15;

export function emptyMeteora(): MeteoraFeed {
  return {
    status: "idle",
    sourceName: "Meteora Stake2Earn",
    ranksWhat:
      "Meteora no publica un ranking de traders sin clave. Esta lista es el top de stakers por stake activo en el vault Stake2Earn con más dólares stakeados.",
    windowLabel: "Sin ventana temporal: orden vigente por stake activo",
    vaultLabel: null,
    vaultAddress: null,
    refreshedAt: null,
    attemptedAt: null,
    error: null,
    wallets: [],
  };
}

export function blankLeader(
  partial: Pick<Leader, "id" | "name" | "kind"> & Partial<Leader>,
): Leader {
  return {
    personality: undefined,
    wallet: undefined,
    enabled: false,
    listed: true,
    rank: null,
    publishedStake: null,
    publishedRewardUsd: null,
    note: "",
    cashSol: 100,
    peakEquity: 100,
    equity: 100,
    holdTicks: 0,
    stats: emptyStats(),
    book: {},
    rpcError: null,
    lastPollAt: null,
    seenSignatures: [],
    ...partial,
  };
}

export function createInitialState(now: number): EngineState {
  return {
    version: 2,
    seq: 1,
    cashSol: STARTING_USD,
    startingEquity: STARTING_USD,
    accountPeak: STARTING_USD,
    settings: { ...defaultSettings, blocklist: [] },
    leaders: [
      blankLeader({
        id: "lumen",
        name: "Lumen",
        kind: "demo",
        personality: "consistent",
        enabled: true,
        note: "Gana con paciencia y vende en dos tramos.",
      }),
      blankLeader({
        id: "rafaga",
        name: "Ráfaga",
        kind: "demo",
        personality: "choppy",
        enabled: true,
        note: "Entra y sale seguido. Resultados mixtos.",
      }),
      blankLeader({
        id: "fosa",
        name: "Fosa",
        kind: "demo",
        personality: "drawdown",
        enabled: true,
        note: "Encadena pérdidas. El motor debe encoger el tamaño y pausarla.",
      }),
    ],
    positions: [],
    trades: [],
    skips: [],
    equityCurve: [{ t: now, equity: STARTING_USD }],
    drawdownCurve: [{ t: now, drawdown: 0 }],
    series: {},
    prices: {
      PaperAURA111111111111111111111111111111111: 0.0042,
      PaperBRUMA11111111111111111111111111111111: 0.0015,
      PaperCIMA111111111111111111111111111111111: 0.0088,
      PaperDUNA111111111111111111111111111111111: 0.0024,
      PaperECO1111111111111111111111111111111111: 0.012,
    },
    mintLastEntry: {},
    kill: {
      manual: false,
      auto: false,
      reason: null,
      dayKey: dayKey(now),
      realizedToday: 0,
    },
    meteora: emptyMeteora(),
    rpcCursor: 0,
    demoTick: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function nextId(state: EngineState, prefix: string): string {
  state.seq += 1;
  return `${prefix}-${state.seq}`;
}

export function markEquity(state: EngineState): number {
  let equity = state.cashSol;
  for (const position of state.positions) {
    const mark = state.prices[position.mint] ?? position.entryPrice;
    equity += exitProceeds(
      position.qty,
      mark,
      state.settings.slippageBps,
      state.settings.feeBps,
    ).proceeds;
  }
  return equity;
}

export function copyPnl(
  state: EngineState,
  leaderId: string,
): { realized: number; unrealized: number; total: number } {
  const realized = state.trades
    .filter((trade) => trade.leaderId === leaderId)
    .reduce((sum, trade) => sum + (trade.pnlSol ?? 0), 0);
  const unrealized = state.positions
    .filter((position) => position.leaderId === leaderId)
    .reduce((sum, position) => {
      const mark = state.prices[position.mint] ?? position.entryPrice;
      const proceeds = exitProceeds(
        position.qty,
        mark,
        state.settings.slippageBps,
        state.settings.feeBps,
      ).proceeds;
      return sum + (proceeds - position.costSol);
    }, 0);
  return { realized, unrealized, total: realized + unrealized };
}

export function markLeader(leader: Leader, prices: Record<string, number>): void {
  let equity = leader.cashSol;
  for (const [mint, position] of Object.entries(leader.book)) {
    equity += position.qty * (prices[mint] ?? 0);
  }
  leader.equity = equity;
  if (equity > leader.peakEquity) leader.peakEquity = equity;
  const drawdown = drawdownPct(leader.peakEquity, equity);
  if (drawdown > leader.stats.maxDrawdown) leader.stats.maxDrawdown = drawdown;
}

function trim<T>(items: T[], cap: number): void {
  if (items.length > cap) items.splice(0, items.length - cap);
}

export function snapshot(state: EngineState, now: number): void {
  const equity = markEquity(state);
  if (equity > state.accountPeak) state.accountPeak = equity;
  const drawdown = drawdownPct(state.accountPeak, equity);
  state.equityCurve.push({ t: now, equity });
  state.drawdownCurve.push({ t: now, drawdown });
  trim(state.equityCurve, CURVE_CAP);
  trim(state.drawdownCurve, CURVE_CAP);
  for (const leader of state.leaders) {
    markLeader(leader, state.prices);
    const point = {
      t: now,
      pnl: copyPnl(state, leader.id).total,
      drawdown: drawdownPct(leader.peakEquity, leader.equity),
    };
    const series = state.series[leader.id] ?? [];
    series.push(point);
    trim(series, SERIES_CAP);
    state.series[leader.id] = series;
  }
  state.updatedAt = now;
}

function syncLeaderBook(leader: Leader, fill: LeaderFill): void {
  const cap = leader.kind === "demo" ? Number.POSITIVE_INFINITY : WALLET_BET_CAP;
  const book = leader.book[fill.mint] ?? { qty: 0, costSol: 0 };
  if (fill.side === "buy") {
    const added = Math.max(0, fill.leaderQtyAfter - fill.leaderQtyBefore);
    const actual = added * fill.fillPriceSol;
    const notional = Math.min(actual, cap);
    if (!(notional > 0) || !(fill.fillPriceSol > 0)) return;
    const qty = notional / fill.fillPriceSol;
    leader.cashSol -= notional;
    book.qty += qty;
    book.costSol += notional;
    leader.book[fill.mint] = book;
    return;
  }
  const fraction = proportionalSellFraction(
    fill.leaderQtyBefore,
    fill.leaderQtyAfter,
  );
  if (!(book.qty > 0) || fraction <= 0) return;
  const sold = book.qty * fraction;
  const costSold = book.costSol * fraction;
  const proceeds = sold * fill.fillPriceSol;
  const pnl = proceeds - costSold;
  leader.cashSol += proceeds;
  book.qty -= sold;
  book.costSol -= costSold;
  if (book.qty <= 1e-9) delete leader.book[fill.mint];
  else leader.book[fill.mint] = book;
  leader.stats.closed += 1;
  if (pnl >= 0) {
    leader.stats.wins += 1;
    leader.stats.grossProfitSol += pnl;
  } else {
    leader.stats.losses += 1;
    leader.stats.grossLossSol += -pnl;
  }
}

function recordSkip(state: EngineState, fill: LeaderFill, reasons: EngineState["skips"][number]["reasons"]): void {
  if (reasons.length === 1 && reasons[0] === "no_position") return;
  state.skips.push({
    id: nextId(state, "skip"),
    leaderId: fill.leaderId,
    mint: fill.mint,
    symbol: fill.symbol,
    side: fill.side,
    reasons,
    ts: fill.observedAt,
  });
  trim(state.skips, 80);
}

function pushTrade(
  state: EngineState,
  input: {
    leaderId: string;
    mint: string;
    symbol: string;
    side: "buy" | "sell";
    qty: number;
    price: number;
    notionalSol: number;
    feeSol: number;
    slippage: number;
    entry: number | null;
    exit: number | null;
    pnlSol: number | null;
    reason: TradeReason;
    ts: number;
    openedAt: number | null;
    closedAt: number | null;
  },
): void {
  state.trades.push({ id: nextId(state, "trade"), ...input });
  trim(state.trades, 300);
}

export function closePosition(
  state: EngineState,
  position: Position,
  fraction: number,
  mark: number,
  reason: TradeReason,
  now: number,
): number {
  const fractionUsed = Math.min(1, Math.max(0, fraction));
  if (!(fractionUsed > 0) || !(position.qty > 0)) return 0;
  const qty = position.qty * fractionUsed;
  const cost = position.costSol * fractionUsed;
  const filled = exitProceeds(qty, mark, state.settings.slippageBps, state.settings.feeBps);
  const pnl = filled.proceeds - cost;
  const slippage = Math.max(0, qty * mark - filled.gross);
  state.cashSol += filled.proceeds;
  position.qty -= qty;
  position.costSol -= cost;
  if (position.qty <= 1e-9) {
    state.positions = state.positions.filter((item) => item.id !== position.id);
  }
  pushTrade(state, {
    leaderId: position.leaderId,
    mint: position.mint,
    symbol: position.symbol,
    side: "sell",
    qty,
    price: filled.price,
    notionalSol: filled.gross,
    feeSol: filled.fee,
    slippage,
    entry: position.entryPrice,
    exit: filled.price,
    pnlSol: pnl,
    reason,
    ts: now,
    openedAt: position.openedAt,
    closedAt: now,
  });
  state.kill.realizedToday += pnl;
  enforceKill(state);
  return pnl;
}

export function enforceKill(state: EngineState): void {
  if (state.kill.manual) return;
  if (state.kill.realizedToday <= -state.settings.dailyLossKillSol) {
    state.kill.auto = true;
    state.kill.reason = "La pérdida realizada de hoy superó el límite. No hay copias nuevas.";
  }
}

export function rollover(state: EngineState, now: number): void {
  const key = dayKey(now);
  if (state.kill.dayKey === key) return;
  state.kill.dayKey = key;
  state.kill.realizedToday = 0;
  state.kill.auto = false;
  if (!state.kill.manual) state.kill.reason = null;
}

export function applyFill(state: EngineState, fill: LeaderFill): void {
  const leader = state.leaders.find((item) => item.id === fill.leaderId);
  if (!leader) return;
  if (fill.currentPriceSol > 0) state.prices[fill.mint] = fill.currentPriceSol;
  syncLeaderBook(leader, fill);
  markLeader(leader, state.prices);

  const decision = evaluateCopy({
    equitySol: markEquity(state),
    cashSol: state.cashSol,
    settings: state.settings,
    leader,
    positions: state.positions,
    mintLastEntry: state.mintLastEntry,
    killActive: state.kill.manual || state.kill.auto,
    fill,
  });

  if (!decision.ok) {
    recordSkip(state, fill, decision.reasons);
    return;
  }

  if (decision.action === "buy") {
    const exec = entryPrice(fill.currentPriceSol, state.settings.slippageBps);
    if (!(exec > 0)) return;
    const fee = feeSol(decision.sizeSol, state.settings.feeBps);
    const qty = decision.sizeSol / exec;
    const slippage = Math.max(0, qty * exec - qty * fill.currentPriceSol);
    state.cashSol -= decision.sizeSol + fee;
    const existing = state.positions.find(
      (position) => position.leaderId === leader.id && position.mint === fill.mint,
    );
    if (existing) {
      const nextQty = existing.qty + qty;
      existing.entryPrice =
        (existing.entryPrice * existing.qty + exec * qty) / nextQty;
      existing.qty = nextQty;
      existing.costSol += decision.sizeSol + fee;
      existing.stopPrice =
        existing.entryPrice * (1 - state.settings.protectiveStopPct);
    } else {
      state.positions.push({
        id: nextId(state, "pos"),
        leaderId: leader.id,
        mint: fill.mint,
        symbol: fill.symbol,
        qty,
        costSol: decision.sizeSol + fee,
        entryPrice: exec,
        openedAt: fill.observedAt,
        stopPrice: exec * (1 - state.settings.protectiveStopPct),
      });
    }
    state.mintLastEntry[fill.mint] = fill.observedAt;
    pushTrade(state, {
      leaderId: leader.id,
      mint: fill.mint,
      symbol: fill.symbol,
      side: "buy",
      qty,
      price: exec,
      notionalSol: decision.sizeSol,
      feeSol: fee,
      slippage,
      entry: exec,
      exit: null,
      pnlSol: null,
      reason: "entrada",
      ts: fill.observedAt,
      openedAt: fill.observedAt,
      closedAt: null,
    });
    return;
  }

  const position = state.positions.find(
    (item) => item.leaderId === leader.id && item.mint === fill.mint && item.qty > 0,
  );
  if (!position) return;
  closePosition(
    state,
    position,
    decision.sellFraction,
    fill.currentPriceSol,
    "salida",
    fill.observedAt,
  );
}

/** Close every open copy at the latest mark, charging fee and slippage. */
export function flattenOpenPositions(state: EngineState, now: number): number {
  const open = state.positions.filter((position) => position.qty > 0);
  for (const position of open) {
    const mark = state.prices[position.mint] ?? position.entryPrice;
    closePosition(state, position, 1, mark, "apagado", now);
  }
  snapshot(state, now);
  return open.length;
}

export function applyProtectiveStops(state: EngineState, now: number): void {
  for (const position of [...state.positions]) {
    const mark = state.prices[position.mint] ?? position.entryPrice;
    if (!stopTriggered(position.entryPrice, mark, state.settings.protectiveStopPct)) {
      continue;
    }
    closePosition(state, position, 1, mark, "stop", now);
  }
}

export function setKill(state: EngineState, active: boolean, now: number): void {
  if (active) {
    state.kill.manual = true;
    state.kill.reason = "Corte manual. No hay copias nuevas.";
  } else {
    state.kill.manual = false;
    state.kill.auto = false;
    state.kill.realizedToday = 0;
    state.kill.reason = null;
  }
  state.updatedAt = now;
}

export function setLeaderEnabled(
  state: EngineState,
  id: string,
  enabled: boolean,
): string | null {
  const leader = state.leaders.find((item) => item.id === id);
  if (!leader) return "Ese líder no está en la mesa.";
  leader.enabled = enabled;
  return null;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidWallet(value: string): boolean {
  return BASE58.test(value.trim());
}

export function addWalletLeader(state: EngineState, wallet: string, now: number): string | null {
  const address = wallet.trim();
  if (!isValidWallet(address)) return "La dirección no parece una wallet de Solana.";
  if (state.leaders.some((leader) => leader.wallet === address)) {
    return "Esa wallet ya está en la mesa.";
  }
  state.leaders.push(
    blankLeader({
      id: nextId(state, "lider"),
      name: `${address.slice(0, 4)}…${address.slice(-4)}`,
      kind: "wallet",
      wallet: address,
      enabled: false,
      listed: false,
      note: "En observación. No se copia hasta que la actives.",
    }),
  );
  state.updatedAt = now;
  return null;
}

export function removeLeader(state: EngineState, id: string, now: number): string | null {
  const leader = state.leaders.find((item) => item.id === id);
  if (!leader) return "Ese líder no está en la mesa.";
  if (leader.kind === "demo") return "Los líderes demo no se pueden quitar.";
  if (leader.kind === "meteora" && leader.listed) {
    return "Sale sola de la lista cuando Meteora ya no la rankea.";
  }
  for (const position of state.positions.filter((item) => item.leaderId === id)) {
    const mark = state.prices[position.mint] ?? position.entryPrice;
    closePosition(state, position, 1, mark, "cierre", now);
  }
  state.leaders = state.leaders.filter((item) => item.id !== id);
  delete state.series[id];
  state.updatedAt = now;
  return null;
}

export function applySettings(state: EngineState, settings: RiskSettings): void {
  state.settings = settings;
}

export function applyMeteoraRoster(
  state: EngineState,
  roster: MeteoraWallet[],
  meta: Pick<MeteoraFeed, "vaultLabel" | "vaultAddress" | "refreshedAt">,
): void {
  const ranked = new Set(roster.map((item) => item.address));
  for (const leader of state.leaders) {
    if (leader.kind !== "meteora") continue;
    if (!leader.wallet || ranked.has(leader.wallet)) continue;
    leader.listed = false;
    leader.rank = null;
    if (!leader.enabled && !state.positions.some((position) => position.leaderId === leader.id)) {
      leader.note = "Salió del top 7 de Meteora.";
    }
  }
  state.leaders = state.leaders.filter((leader) => {
    if (leader.kind !== "meteora" || leader.listed) return true;
    if (leader.enabled) return true;
    if (state.positions.some((position) => position.leaderId === leader.id)) return true;
    if (state.trades.some((trade) => trade.leaderId === leader.id)) return true;
    delete state.series[leader.id];
    return false;
  });

  for (const item of roster) {
    const existing = state.leaders.find((leader) => leader.wallet === item.address);
    if (existing) {
      existing.kind = "meteora";
      existing.listed = true;
      existing.rank = item.rank;
      existing.publishedStake = item.stakedAmount;
      existing.publishedRewardUsd = item.rewardUsd;
      existing.name = `Stake2Earn #${item.rank}`;
      continue;
    }
    state.leaders.push(
      blankLeader({
        id: `met-${item.address.slice(0, 8)}`,
        name: `Stake2Earn #${item.rank}`,
        kind: "meteora",
        wallet: item.address,
        enabled: false,
        listed: true,
        rank: item.rank,
        publishedStake: item.stakedAmount,
        publishedRewardUsd: item.rewardUsd,
        note: "En observación. No se copia hasta que actives el interruptor.",
      }),
    );
  }

  state.meteora = {
    ...state.meteora,
    status: "ok",
    vaultLabel: meta.vaultLabel,
    vaultAddress: meta.vaultAddress,
    refreshedAt: meta.refreshedAt,
    attemptedAt: meta.refreshedAt,
    error: null,
    wallets: roster,
  };
}

export function markMeteoraUnavailable(state: EngineState, error: string, now: number): void {
  state.meteora = {
    ...state.meteora,
    status: state.meteora.wallets.length > 0 ? "ok" : "unavailable",
    error,
    attemptedAt: now,
  };
}
