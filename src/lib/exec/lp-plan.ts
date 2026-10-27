/**
 * What the Meteora live bot may open or close.
 * No network and no keys: the runner asks the chain only for what this returns.
 */

import { passes, toSnap, WSOL, type PoolSnap, type RawPair, type ScreenRules } from "../lp/meteora";
import { keepOnePoolPerName } from "../lp/history";
import type { LiveParams } from "./live-params";
import type { LivePosition } from "./live-book";

/** Bins strictly below the price that fit one standard DLMM position. */
export const MAX_POSITION_BINS = 69;
/** Bins of a standard position account (SDK `DEFAULT_BIN_PER_POSITION`). Wider ones are extended. */
export const STANDARD_POSITION_BINS = 70;
/** Hard ceiling of an extended position (SDK `MAX_BINS_PER_POSITION`). */
export const MAX_EXTENDED_BINS = 1400;
/** Rent returned when a standard position account is closed. */
export const POSITION_RENT_LAMPORTS = 60_000_000;
/** Extra returnable rent per bin past the standard 70 (112 bytes each), rounded up. */
export const EXTRA_BIN_RENT_LAMPORTS = 600_000;

/** Returnable rent of a position with `bins` bins, slightly over the chain's price. */
export function positionRentLamports(bins: number): number {
  return POSITION_RENT_LAMPORTS + Math.max(0, bins - STANDARD_POSITION_BINS) * EXTRA_BIN_RENT_LAMPORTS;
}
export const OPEN_FEE_LAMPORTS = 5_000_000;
export const MIN_OPEN_LAMPORTS = 10_000_000;

export type LiveCandidate = PoolSnap & {
  solIsY: boolean;
  tokenMint: string;
  /** Pool creation time from the Data API, when it says. */
  createdAt?: number | null;
};

/**
 * What the chain says one open position is worth right now.
 * `valueLamports` is the SOL in the position plus its token and unclaimed fees
 * at the active-bin price. `price` is SOL per token at that bin.
 */
export type PositionMark = { exists: boolean; valueLamports: number; price: number };

/** A pool whose open failed before anything was signed sits out this long. */
export const SKIP_POOL_MS = 6 * 3_600_000;

/** Rent of one DLMM bin array (SDK `BIN_ARRAY_FEE`). Paid by whoever creates it and never returned. */
export const BIN_ARRAY_RENT_LAMPORTS = 71_437_440;

/** The open is refused when the on-chain price is this far from the screened price. */
export const MAX_OPEN_PRICE_DRIFT = 0.1;

/** `pricePerToken` from the SDK is X priced in Y. Returns SOL per token either way. */
export function solPerToken(pricePerToken: number, solIsY: boolean): number {
  if (!(pricePerToken > 0) || !Number.isFinite(pricePerToken)) return 0;
  return solIsY ? pricePerToken : 1 / pricePerToken;
}

/** Lamports a position is worth: its SOL, plus its token and unclaimed fees at `solPerToken`. */
export function positionValue(input: {
  solIsY: boolean;
  totalX: number;
  totalY: number;
  feeX: number;
  feeY: number;
  tokenDecimals: number;
  solPerToken: number;
}): number {
  const x = (input.totalX || 0) + (input.feeX || 0);
  const y = (input.totalY || 0) + (input.feeY || 0);
  const solRaw = input.solIsY ? y : x;
  const tokenRaw = input.solIsY ? x : y;
  const tokenValue = input.solPerToken > 0 ? (tokenRaw / 10 ** input.tokenDecimals) * input.solPerToken * 1_000_000_000 : 0;
  return solRaw + tokenValue;
}

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

/**
 * Bins strictly below the active price that cover `range`.
 * Null when they need more than `maxBins` in one position.
 */
export function binsBelow(range: number, binStep: number, maxBins = MAX_POSITION_BINS): number | null {
  const stepBps = binStepBps(binStep);
  if (stepBps == null || !(range > 0) || range >= 1) return null;
  const step = stepBps / 10_000;
  const bins = Math.ceil(-Math.log(1 - range) / Math.log(1 + step));
  if (!Number.isFinite(bins) || bins < 1 || bins > Math.min(maxBins, MAX_EXTENDED_BINS)) return null;
  return bins;
}

/**
 * One standard position at a 2% bin step covers 74%, one point inside the 75%
 * strategy. Anything shorter is a different bet and stays closed.
 */
export const MIN_LIVE_RANGE = 0.74;

/** The range actually placed. Shrinks by at most one point so a pool still fits `maxBins`. */
export function positionRange(target: number, binStep: number, maxBins = MAX_POSITION_BINS): { range: number; bins: number } | null {
  const exact = binsBelow(target, binStep, maxBins);
  if (exact != null) return { range: target, bins: exact };
  if (!(target >= MIN_LIVE_RANGE) || target - MIN_LIVE_RANGE > 0.01 + 1e-9) return null;
  const fitted = binsBelow(MIN_LIVE_RANGE, binStep, maxBins);
  if (fitted == null) return null;
  return { range: MIN_LIVE_RANGE, bins: fitted };
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
  const created = Number(pair.created_at);
  return { ...snap, solIsY, tokenMint: solIsY ? mintX : mintY, createdAt: created > 0 ? created : null };
}

/** Old enough to trade. With an age required, a pool of unknown age stays out. */
export function oldEnough(pool: LiveCandidate, minAgeDays: number, now: number): boolean {
  if (!(minAgeDays > 0)) return true;
  if (!pool.createdAt) return false;
  return now - pool.createdAt >= minAgeDays * 86_400_000;
}

export function choosePool(
  candidates: LiveCandidate[],
  rules: ScreenRules & { minAgeDays?: number },
  range: number,
  busy: Set<string>,
  maxBins = MAX_POSITION_BINS,
  now = Date.now(),
): LiveCandidate | null {
  const ready = candidates.filter(
    (pool) => passes(pool, rules) && oldEnough(pool, rules.minAgeDays ?? 0, now) && !busy.has(pool.address) && !busy.has(pool.tokenMint) && positionRange(range, pool.binStep, maxBins) != null,
  );
  ready.sort((a, b) => b.fees24h / b.tvl - a.fees24h / a.tvl);
  return ready[0] ?? null;
}

/**
 * Exits use the position's on-chain value, fees included. Without a read only
 * the time exit can fire: a stop or take-profit never runs on a guess.
 */
function markAt(position: LivePosition, mark: PositionMark | undefined, now: number, params: LiveParams): LivePosition {
  if (position.closing) return position;
  if (now - position.openedAt >= params.holdHours * 3_600_000) {
    return { ...position, closing: true, closeReason: "time", note: "Se cumplió el tiempo. Cerrando." };
  }
  if (!mark) return { ...position, note: "No se pudo leer la posición en la cadena. Solo corre el cierre por tiempo." };
  if (!mark.exists) return { ...position, closing: true, closeReason: "gone", note: "La posición ya no está en la cadena." };
  const price = mark.price > 0 ? mark.price : null;
  const stake = position.stakeSol * 1_000_000_000;
  const positionPct = stake > 0 && Number.isFinite(mark.valueLamports) ? mark.valueLamports / stake - 1 : null;
  const tokenPct = price && position.entryPrice ? price / position.entryPrice - 1 : null;
  const marked: LivePosition = { ...position, lastPrice: price ?? position.lastPrice, tokenPct, positionPct, note: "" };
  if (price && position.lastPrice && price / position.lastPrice <= 0.8) {
    return { ...marked, closing: true, closeReason: "rug", note: "El precio cayó de golpe. Cerrando." };
  }
  // No re-center when the token runs up: in the Sep–Oct 2026 hourly backtest that close-and-reopen
  // churn was 3 of every 4 exits, earned almost no fees and paid fees on every round trip.
  if (positionPct == null) return marked;
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
  candidates: LiveCandidate[];
  marks: Record<string, PositionMark | undefined>;
  /** Pool address → time until which it may not be opened. */
  skipped?: Record<string, number>;
  now: number;
  pendingOpen: boolean;
  /** Widest position the chain side may build. Defaults to one standard position. */
  maxBins?: number;
}): LivePlan {
  const maxBins = input.maxBins ?? MAX_POSITION_BINS;
  const positions = input.positions.map((position) => {
    if (input.kill && position.signature && !position.closing) {
      return { ...position, closing: true, closeReason: "stop" as const, note: "Corte de emergencia. Cerrando." };
    }
    return markAt(position, input.marks[position.address], input.now, input.params);
  });
  const closing = positions.some((position) => position.closing);
  if (input.kill || !input.running) {
    return { positions, open: null, notice: input.kill ? "Corte de emergencia: no se abren posiciones." : closing ? "Cerrando lo que queda abierto." : "Apagado." };
  }
  if (closing || input.pendingOpen) {
    return { positions, open: null, notice: input.pendingOpen ? "Hay una apertura a medias. No se abre otra hasta confirmarla." : "Primero se cierran las que ya pidieron salida." };
  }
  // A token held in one pool blocks its other pools: two pools of one memecoin double the same risk.
  const busy = new Set(positions.flatMap((position) => (position.tokenMint ? [position.address, position.tokenMint] : [position.address])));
  for (const [address, until] of Object.entries(input.skipped ?? {})) if (until > input.now) busy.add(address);
  const pool = choosePool(input.candidates, input.params, input.params.range, busy, maxBins, input.now);
  const shaped = pool ? positionRange(input.params.range, pool.binStep, maxBins) : null;
  const openStakeLamports = positions.filter((position) => !position.closing).reduce((sum, position) => sum + Math.round(position.stakeSol * 1_000_000_000), 0);
  const lamports = openLamports({
    balanceLamports: input.balanceLamports,
    reserveLamports: input.reserveLamports,
    rentLamports: positionRentLamports(shaped?.bins ?? 0),
    feeLamports: OPEN_FEE_LAMPORTS,
    maxLamports: Math.round(input.maxSol * 1_000_000_000),
    openStakeLamports,
    slot: input.params.slot,
  });
  if (!pool || !shaped || lamports <= 0) {
    const why = lamports <= 0 ? "El SOL libre no alcanza para una posición y la reserva." : "Ningún pool que pase el filtro cabe en una sola posición con este rango.";
    return { positions, open: null, notice: `${why} No se envió nada.` };
  }
  const width = shaped.range < input.params.range ? ` al ${Math.round(shaped.range * 100)}%` : "";
  return {
    positions,
    open: {
      pool: pool.address,
      name: pool.name,
      solIsY: pool.solIsY,
      tokenMint: pool.tokenMint,
      lamports,
      bins: shaped.bins,
      price: pool.price,
      range: shaped.range,
      binStepBps: binStepBps(pool.binStep) ?? 0,
    },
    notice: `Abriendo ${pool.name}${width}.`,
  };
}
