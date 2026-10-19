import { drawdownPct } from "./money";
import { proportionalSellFraction } from "./exits";
import { sizeEntrySol } from "./sizing";
import type {
  CopyDecision,
  LeaderFill,
  Position,
  RejectReason,
  RiskSettings,
} from "./types";
import { REASON_ORDER } from "./types";

export type FilterInput = {
  equitySol: number;
  cashSol: number;
  settings: RiskSettings;
  leader: {
    id: string;
    enabled: boolean;
    equity: number;
    peakEquity: number;
  };
  positions: Position[];
  mintLastEntry: Record<string, number>;
  killActive: boolean;
  fill: LeaderFill;
};

function sortReasons(reasons: RejectReason[]): RejectReason[] {
  return [...reasons].sort(
    (a, b) => REASON_ORDER.indexOf(a) - REASON_ORDER.indexOf(b),
  );
}

function ourPosition(input: FilterInput): Position | undefined {
  return input.positions.find(
    (position) =>
      position.leaderId === input.leader.id &&
      position.mint === input.fill.mint &&
      position.qty > 0,
  );
}

/**
 * Every copied trade has to clear the full rule set. Independent failures
 * are collected together so the desk can show why a signal was skipped.
 */
export function evaluateCopy(input: FilterInput): CopyDecision {
  const { fill, settings } = input;
  const reasons: RejectReason[] = [];
  const isBuy = fill.side === "buy";
  const drawdown = drawdownPct(input.leader.peakEquity, input.leader.equity);

  if (isBuy && !input.leader.enabled) reasons.push("observation");
  if (isBuy && input.killActive) reasons.push("kill_switch");
  if (isBuy && drawdown >= settings.leaderDrawdownPause) {
    reasons.push("leader_paused");
  }
  if (isBuy && settings.blocklist.includes(fill.mint)) reasons.push("blocklist");

  const age = fill.observedAt - fill.fillTime;
  if (!Number.isFinite(age) || age > settings.maxSignalAgeMs) {
    reasons.push("stale_age");
  }

  const drift =
    fill.fillPriceSol > 0
      ? Math.abs(fill.currentPriceSol - fill.fillPriceSol) / fill.fillPriceSol
      : Number.POSITIVE_INFINITY;
  if (drift > settings.maxPriceDriftBps / 10_000) reasons.push("price_drift");

  if (isBuy) {
    const last = input.mintLastEntry[fill.mint] ?? 0;
    if (last > 0 && fill.observedAt - last < settings.mintCooldownMs) {
      reasons.push("cooldown");
    }
  }

  if (!isBuy) {
    const position = ourPosition(input);
    if (!position) {
      reasons.push("no_position");
      return { ok: false, action: "skip", reasons: sortReasons(reasons) };
    }
    const sellFraction = proportionalSellFraction(
      fill.leaderQtyBefore,
      fill.leaderQtyAfter,
    );
    if (sellFraction <= 0) {
      reasons.push("zero_fraction");
      return { ok: false, action: "skip", reasons: sortReasons(reasons) };
    }
    const qty = position.qty * sellFraction;
    const notionalSol = qty * Math.max(0, fill.currentPriceSol);
    if (sellFraction < 0.999 && notionalSol < settings.minSol) {
      reasons.push("dust");
    }
    if (reasons.length > 0) {
      return { ok: false, action: "skip", reasons: sortReasons(reasons) };
    }
    return { ok: true, action: "sell", sellFraction, qty, notionalSol };
  }

  const leaderUsedSol = input.positions
    .filter((position) => position.leaderId === input.leader.id)
    .reduce((sum, position) => sum + position.costSol, 0);

  const sized = sizeEntrySol({
    equitySol: input.equitySol,
    cashSol: input.cashSol,
    fraction: settings.fraction,
    fractionCap: settings.fractionCap,
    drawdown,
    pauseDrawdown: settings.leaderDrawdownPause,
    leaderUsedSol,
    leaderCapSol: settings.leaderCapitalCapSol,
    minSol: settings.minSol,
    feeBps: settings.feeBps,
    leaderNotionalSol: fill.leaderNotionalSol,
  });

  if (!sized.ok && sized.reason !== "drawdown_pause") {
    reasons.push(sized.reason);
  }

  if (!sized.ok || reasons.length > 0) {
    return {
      ok: false,
      action: "skip",
      reasons: sortReasons(reasons.length > 0 ? reasons : ["dust"]),
    };
  }

  return { ok: true, action: "buy", sizeSol: sized.sizeSol, shrink: sized.shrink };
}
