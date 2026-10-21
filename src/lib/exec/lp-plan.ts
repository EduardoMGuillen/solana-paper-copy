/**
 * What the Meteora live bot may open or close.
 * No network and no keys: the runner asks the chain only for what this returns.
 */

import { bidAskBins, bidAskValue } from "../lp/bidask";
import { passes, toSnap, WSOL, type PoolSnap, type RawPair, type ScreenRules } from "../lp/meteora";
import { keepOnePoolPerName } from "../lp/history";
import type { LiveParams } from "./live-params";
import type { LivePosition } from "./live-book";

/** One standard DLMM position. Wider ranges need a coarser bin step. */
export const MAX_POSITION_BINS = 69;
/** Rent returned when the position account is closed. */
export const POSITION_RENT_LAMPORTS = 60_000_000;
export const OPEN_FEE_LAMPORTS = 5_000_000;
export const MIN_OPEN_LAMPORTS = 10_000_000;

export type LiveCandidate = PoolSnap & { solIsY: boolean; tokenMint: string };

export type OpenOrder = {
  pool: string;
  name: string;
  solIsY: boolean;
  tokenMint: string;
  lamports: number;
  bins: number;
  price: number;
  range: number;
  binStepBps: number;
};

export type LivePlan = {
  positions: LivePosition[];
  open: OpenOrder | null;
  notice: string;
};

export function binStepBps(binStep: number): number | null {
  if (!(binStep > 0)) return null;
  return binStep < 1 ? Math.round(binStep * 10_000) : Math.round(binStep);
}

/** Bins strictly below the active price that cover `range`. Null when they do not fit one position. */
export function binsBelow(range: number, binStep: number): number | null {
  const stepBps = binStepBps(binStep);
  if (stepBps == null || !(range > 0) || range >= 1) return null;
  const step = stepBps / 10_000;
  const bins = Math.ceil(-Math.log(1 - range) / Math.log(1 + step));
  if (!Number.isFinite(bins) || bins < 1 || bins > MAX_POSITION_BINS) return null;
  return bins;
}

export function openLamports(input: {
  balanceLamports: number;
  reserveLamports: number;
  rentLamports: number;
  feeLamports: number;
  maxLamports: number;
  openStakeLamports: number;
  slot: number;
}): number {
  const spendable = input.balanceLamports - input.reserveLamports - input.rentLamports - input.feeLamports;
  const room = input.maxLamports - input.openStakeLamports;
  const slot = Math.floor(input.slot * input.balanceLamports);
  const lamports = Math.min(spendable, room, slot);
  if (!Number.isFinite(lamports) || lamports < MIN_OPEN_LAMPORTS) return 0;
  return Math.floor(lamports);
}

export function liveCandidates(pairs: RawPair[], now: number): LiveCandidate[] {
  const rows: LiveCandidate[] = [];
  for (const pair of pairs) {
    const snap = toCandidate(pair, now);
    if (snap) rows.push(snap);
  }
  const kept = new Set(keepOnePoolPerName(rows).map((snap) => snap.address));
  return rows.filter((row) => kept.has(row.address));
}

function toCandidate(pair: RawPair, now: number): LiveCandidate | null {
  const mintX = pair.mint_x ?? pair.token_x?.address;
  const mintY = pair.mint_y ?? pair.token_y?.address;
  if (!mintX || !mintY) return null;
  const solIsY = mintY === WSOL;
  const solIsX = mintX === WSOL;
  if (!solIsY && !solIsX) return null;
  const snap = toSnap(pair, now);
  if (!snap) return null;
  return { ...snap, solIsY, tokenMint: solIsY ? mintX : mintY };
}

export function choosePool(candidates: LiveCandidate[], rules: ScreenRules, range: number, busy: Set<string>): LiveCandidate | null {
  const ready = candidates.filter((pool) => passes(pool, rules) && !busy.has(pool.address) && binsBelow(range, pool.binStep) != null);
  ready.sort((a, b) => b.fees24h / b.tvl - a.fees24h / a.tvl);
  return ready[0] ?? null;
}

function markAt(position: LivePosition, price: number | undefined, pool: LiveCandidate | undefined, now: number, params: LiveParams): LivePosition {
  if (position.closing) return position;
  const entry = position.entryPrice;
  const next: LivePosition = { ...position, lastPrice: price && price > 0 ? price : position.lastPrice };
  if (now - position.openedAt >= params.holdHours * 3_600_000) {
    return { ...next, closing: true, closeReason: "time", note: "Se cumplió el tiempo. Cerrando." };
  }
  if (!(entry && price && price > 0)) return next;
  if (position.lastPrice && price / position.lastPrice <= 0.8) {
    return { ...next, closing: true, closeReason: "rug", note: "El precio cayó de golpe. Cerrando." };
  }
  const step = position.binStepBps != null ? position.binStepBps / 10_000 : params.binStep;
  const range = position.range ?? params.range;
  const ratio = price / entry;
  const value = bidAskValue(bidAskBins({ range, binStep: step }), ratio);
  const hours = Math.min(1, Math.max(0, (now - position.openedAt) / 3_600_000));
  const fee = pool && pool.tvl > 0 ? hours * (pool.fees1h / pool.tvl) : 0;
  const positionPct = value - 1 + fee;
  const marked: LivePosition = { ...next, tokenPct: ratio - 1, positionPct };
  if (positionPct >= params.takeProfit) return { ...marked, closing: true, closeReason: "take-profit", note: "Llegó a la toma. Cerrando." };
  if (positionPct <= -params.stopLoss) return { ...marked, closing: true, closeReason: "loss", note: "Llegó al stop. Cerrando." };
  return marked;
}

export function planLiveLp(input: {
  running: boolean;
  kill: boolean;
  balanceLamports: number;
  reserveLamports: number;
  maxSol: number;
  params: LiveParams;
  positions: LivePosition[];
  blocked: string[];
  candidates: LiveCandidate[];
  prices: Record<string, number>;
  now: number;
  pendingOpen: boolean;
}): LivePlan {
  const positions = input.positions.map((position) => {
    if (input.kill && position.signature && !position.closing) {
      return { ...position, closing: true, closeReason: "stop" as const, note: "Corte de emergencia. Cerrando." };
    }
    return markAt(position, input.prices[position.address], input.candidates.find((pool) => pool.address === position.address), input.now, input.params);
  });
  const closing = positions.some((position) => position.closing);
  if (input.kill || !input.running) {
    return { positions, open: null, notice: input.kill ? "Corte de emergencia: no se abren posiciones." : closing ? "Cerrando lo que queda abierto." : "Apagado." };
  }
  if (closing || input.pendingOpen) {
    return { positions, open: null, notice: input.pendingOpen ? "Hay una apertura a medias. No se abre otra hasta confirmarla." : "Primero se cierran las que ya pidieron salida." };
  }
  const busy = new Set([...positions.map((position) => position.address), ...input.blocked]);
  const pool = choosePool(input.candidates, input.params, input.params.range, busy);
  const openStakeLamports = positions.filter((position) => !position.closing).reduce((sum, position) => sum + Math.round(position.stakeSol * 1_000_000_000), 0);
  const lamports = openLamports({
    balanceLamports: input.balanceLamports,
    reserveLamports: input.reserveLamports,
    rentLamports: POSITION_RENT_LAMPORTS,
    feeLamports: OPEN_FEE_LAMPORTS,
    maxLamports: Math.round(input.maxSol * 1_000_000_000),
    openStakeLamports,
    slot: input.params.slot,
  });
  if (!pool || lamports <= 0) {
    const why = lamports <= 0 ? "El SOL libre no alcanza para una posición y la reserva." : "Ningún pool que pase el filtro cabe en una sola posición con este rango.";
    return { positions, open: null, notice: `${why} No se envió nada.` };
  }
  const bins = binsBelow(input.params.range, pool.binStep);
  if (bins == null) return { positions, open: null, notice: "El rango no cabe en una posición. No se envió nada." };
  return {
    positions,
    open: {
      pool: pool.address,
      name: pool.name,
      solIsY: pool.solIsY,
      tokenMint: pool.tokenMint,
      lamports,
      bins,
      price: pool.price,
      range: input.params.range,
      binStepBps: binStepBps(pool.binStep) ?? 0,
    },
    notice: `Abriendo ${pool.name}.`,
  };
}
