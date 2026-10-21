import { bidAskBins, bidAskValue, DECODER_SHAPE, lowerEdge, type BidAskShape } from "./bidask";
import {
  DECODER_EXITS,
  DECODER_RULES,
  feeTvl24h,
  passes,
  type ExitRules,
  type LpTrade,
  type PoolSnap,
  type ScreenRules,
} from "./meteora";

/**
 * Share of equity for a new position when no later size is set.
 * A settings screen will replace this and `METEORA_NEXT_SLOT`.
 */
export const METEORA_SLOT = 0.25;

/** Share used for positions opened after the book is told to allow more. */
export const METEORA_NEXT_SLOT = 0.1;

/**
 * SOL for one new position. A leftover within 2% of a full slot is used whole,
 * so a tiny mark does not leave a fourth slot stuck in cash.
 */
export function slotStake(cash: number, equity: number, slot = METEORA_SLOT): number | null {
  if (!(equity > 0) || !(cash > 0)) return null;
  const full = equity * slot;
  if (cash + 1e-9 >= full) return full;
  if (cash >= full * 0.98) return cash;
  return null;
}

/** One open paper position. `stake` is the SOL assigned to it, not the whole experiment. */
export type OpenMeteora = {
  address: string;
  name: string;
  entryT: number;
  entryPrice: number;
  /** SOL deployed in this position at entry. */
  stake: number;
  fees: number;
  mark: number;
  result: number;
  /** Latest token price divided by the entry price. 1.04 means the token is up 4%. */
  priceRatio: number;
};

export type MeteoraBook = {
  /** SOL not deployed in an open position. */
  cash: number;
  /** Cash plus each open position marked to its last price. */
  equity: number;
  trades: LpTrade[];
  opens: OpenMeteora[];
};

/**
 * Snaps at or after `slotFrom` size new positions at `METEORA_SLOT`.
 * Earlier snaps keep the original rule: one position, the whole SOL.
 * Omitting it sizes every snap at 25%.
 */
export type ManualClose = { address: string; name: string; at: number };

export type BookSizing = {
  slotFrom?: number;
  /** Positions opened at or after this time use `slot` (default `METEORA_NEXT_SLOT`). */
  resizeFrom?: number;
  slot?: number;
  /** Close these pools at `at` and do not open them again. */
  manualCloses?: ManualClose[];
};

const FEE_HOURS_CAP = 1;

type Held = OpenMeteora & { minRatio: number; lastT: number };

/**
 * Forward paper book. New positions take 25% of equity, highest 24h fees/TVL
 * first. Two pools that share a name count as one token, so only the better
 * one is opened. Fees between snapshots use the same
 * rate as `simulateLp`, capped at one hour so a gap while the process was
 * down does not invent a day of income.
 */
export function runMeteoraBook(
  snaps: PoolSnap[],
  rules: ScreenRules = DECODER_RULES,
  shape: BidAskShape = DECODER_SHAPE,
  exits: ExitRules = DECODER_EXITS,
  sizing: BookSizing = {},
): MeteoraBook {
  rules = rules ?? DECODER_RULES;
  shape = shape ?? DECODER_SHAPE;
  exits = exits ?? DECODER_EXITS;
  const bins = bidAskBins(shape);
  const byTime = new Map<number, PoolSnap[]>();
  for (const snap of snaps) {
    const list = byTime.get(snap.t) ?? [];
    list.push(snap);
    byTime.set(snap.t, list);
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);
  let cash = 1;
  const trades: LpTrade[] = [];
  let full: Held | null = null;
  let opens: Held[] = [];
  let slotted = sizing.slotFrom == null;

  const accountEquity = (): number => cash + opens.reduce((sum, pos) => sum + pos.stake * Math.max(0, 1 + pos.result), 0);

  const enterSlots = (): void => {
    if (slotted) return;
    slotted = true;
    if (!full) return;
    const equity = cash * Math.max(0, 1 + full.result);
    const stake = equity * METEORA_SLOT;
    const marked = stake * Math.max(0, 1 + full.result);
    cash = equity - marked;
    opens = [{ ...full, stake }];
    full = null;
  };

  const appliedManual = new Set<string>();
  const banned = new Set<string>();
  const bannedNames = new Set<string>();

  const pushTrade = (pos: Held, exitT: number, reason: LpTrade["reason"]): void => {
    trades.push({
      address: pos.address,
      name: pos.name,
      entryT: pos.entryT,
      exitT,
      minRatio: pos.minRatio,
      exitRatio: pos.priceRatio,
      fees: pos.fees,
      mark: pos.mark,
      result: pos.result,
      reason,
    });
  };

  const recordTrade = (pos: Held, snap: PoolSnap, reason: LpTrade["reason"]): void => {
    pushTrade(pos, snap.t, reason);
  };

  const ban = (exit: { address: string; name: string }): void => {
    banned.add(exit.address);
    bannedNames.add(exit.name);
    appliedManual.add(exit.address);
  };

  const applyManual = (t: number): void => {
    for (const exit of sizing.manualCloses ?? []) {
      if (appliedManual.has(exit.address) || exit.at > t) continue;
      if (full?.address === exit.address) {
        pushTrade(full, exit.at, "manual");
        cash *= Math.max(0, 1 + full.result);
        full = null;
        ban(exit);
        continue;
      }
      const pos = opens.find((open) => open.address === exit.address);
      if (!pos) {
        ban(exit);
        continue;
      }
      pushTrade(pos, exit.at, "manual");
      cash += pos.stake * Math.max(0, 1 + pos.result);
      opens = opens.filter((open) => open.address !== exit.address);
      ban(exit);
    }
  };

  const slotAt = (t: number): number =>
    sizing.resizeFrom != null && t >= sizing.resizeFrom ? (sizing.slot ?? METEORA_NEXT_SLOT) : METEORA_SLOT;

  const markHeld = (pos: Held, snap: PoolSnap): LpTrade["reason"] | null => {
    const ratio = snap.price / pos.entryPrice;
    pos.minRatio = Math.min(pos.minRatio, ratio);
    const hours = Math.min(FEE_HOURS_CAP, Math.max(0, (snap.t - pos.lastT) / 3_600_000));
    if (ratio < 1 && ratio > lowerEdge(shape) && Number.isFinite(snap.fees1h) && snap.tvl > 0) {
      pos.fees += (snap.fees1h / snap.tvl) * hours;
    }
    pos.lastT = snap.t;
    pos.priceRatio = ratio;
    pos.mark = bidAskValue(bins, ratio) - 1;
    pos.result = pos.mark + pos.fees;
    if (ratio <= lowerEdge(shape)) return "fuera de rango";
    if (pos.result >= exits.takeProfit) return "take-profit";
    if (pos.result <= -exits.stopLoss) return "stop";
    if (snap.t - pos.entryT >= exits.holdHours * 3_600_000) return "tiempo";
    return null;
  };

  const openBest = (rows: PoolSnap[], blocked: Set<string>, t: number): void => {
    const held = new Set(opens.map((pos) => pos.address));
    const ranked = rows
      .filter((row) => passes(row, rules) && !held.has(row.address) && !blocked.has(row.address) && !banned.has(row.address) && !bannedNames.has(row.name))
      .sort((a, b) => feeTvl24h(b) - feeTvl24h(a));
    for (const best of ranked) {
      if (opens.some((pos) => pos.address === best.address || pos.name === best.name)) continue;
      const stake = slotStake(cash, accountEquity(), slotAt(t));
      if (stake == null) break;
      cash -= stake;
      opens.push({
        address: best.address,
        name: best.name,
        entryT: best.t,
        entryPrice: best.price,
        stake,
        fees: 0,
        minRatio: 1,
        lastT: best.t,
        mark: 0,
        result: 0,
        priceRatio: 1,
      });
    }
  };

  for (const t of times) {
    if (sizing.slotFrom != null && t >= sizing.slotFrom) enterSlots();
    const rows = byTime.get(t) ?? [];
    if (!slotted) {
      let closedHere = false;
      if (full) {
        const snap = rows.find((row) => row.address === full!.address);
        if (snap && snap.t > full.entryT) {
          const reason = markHeld(full, snap);
          if (reason) {
            recordTrade(full, snap, reason);
            cash *= Math.max(0, 1 + full.result);
            full = null;
            closedHere = true;
          }
        }
      }
      if (!full && !closedHere) {
        const best = rows.filter((row) => passes(row, rules)).sort((a, b) => feeTvl24h(b) - feeTvl24h(a))[0];
        if (best) {
          full = {
            address: best.address,
            name: best.name,
            entryT: best.t,
            entryPrice: best.price,
            stake: cash,
            fees: 0,
            minRatio: 1,
            lastT: best.t,
            mark: 0,
            result: 0,
            priceRatio: 1,
          };
        }
      }
      continue;
    }
    const blocked = new Set<string>();
    const still: Held[] = [];
    for (const pos of opens) {
      const snap = rows.find((row) => row.address === pos.address);
      if (!snap || snap.t <= pos.entryT) {
        still.push(pos);
        continue;
      }
      const reason = markHeld(pos, snap);
      if (!reason) {
        still.push(pos);
        continue;
      }
      recordTrade(pos, snap, reason);
      cash += pos.stake * Math.max(0, 1 + pos.result);
      blocked.add(pos.address);
    }
    opens = still;
    applyManual(t);
    openBest(rows, blocked, t);
  }

  if (sizing.slotFrom != null) enterSlots();
  applyManual(Number.POSITIVE_INFINITY);
  if (full) {
    return {
      cash,
      equity: cash * Math.max(0, 1 + full.result),
      trades,
      opens: [{ ...full }],
    };
  }
  return { cash, equity: accountEquity(), trades, opens: opens.map((pos) => ({ ...pos })) };
}
