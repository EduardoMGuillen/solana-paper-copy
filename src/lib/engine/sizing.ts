export type SizeInput = {
  equitySol: number;
  cashSol: number;
  fraction: number;
  fractionCap: number;
  drawdown: number;
  pauseDrawdown: number;
  leaderUsedSol: number;
  leaderCapSol: number;
  minSol: number;
  feeBps: number;
  /** Never used. Copy size is a fraction of our equity, not the leader's bet. */
  leaderNotionalSol: number;
};

export type SizeResult =
  | { ok: true; sizeSol: number; shrink: number }
  | {
      ok: false;
      reason: "dust" | "leader_cap" | "no_cash" | "no_equity" | "drawdown_pause";
    };

/**
 * Fixed fraction of our equity, capped, then shrunk as the leader's
 * drawdown approaches the pause limit. The leader's notional is ignored.
 */
export function sizeEntrySol(input: SizeInput): SizeResult {
  void input.leaderNotionalSol;

  if (!(input.equitySol > 0)) return { ok: false, reason: "no_equity" };
  if (input.drawdown >= input.pauseDrawdown) {
    return { ok: false, reason: "drawdown_pause" };
  }

  const cap = Math.max(0, input.fractionCap);
  const fraction = Math.min(Math.max(0, input.fraction), cap);
  const shrink =
    input.pauseDrawdown > 0
      ? Math.max(0, 1 - input.drawdown / input.pauseDrawdown)
      : 0;
  let size = input.equitySol * fraction * shrink;

  const room = Math.max(0, input.leaderCapSol - input.leaderUsedSol);
  if (room <= 0) return { ok: false, reason: "leader_cap" };
  size = Math.min(size, room);

  const feeRate = Math.max(0, input.feeBps) / 10_000;
  const affordable = input.cashSol / (1 + feeRate);
  if (!(affordable > 0)) return { ok: false, reason: "no_cash" };
  size = Math.min(size, affordable);

  if (!(size > 0) || size < input.minSol) return { ok: false, reason: "dust" };
  return { ok: true, sizeSol: size, shrink };
}
