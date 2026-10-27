/**
 * Whether the token left by a closed Meteora position may be swapped back to SOL.
 * The DLMM quote reports price impact as a percent: 1.5 means 1.5%.
 */

/** Below this SOL out, the swap costs more than the token is worth. */
export const MIN_SELL_LAMPORTS = 1_000_000;

/** A leftover this small is dropped instead of retried. */
export const DUST_SELL_REASON = "The leftover token is not worth the sale. It stayed in the wallet.";

export function impactTooHigh(priceImpactPercent: number, maxImpactBps: number): boolean {
  if (!Number.isFinite(priceImpactPercent) || priceImpactPercent < 0) return true;
  if (!Number.isFinite(maxImpactBps) || maxImpactBps < 0) return true;
  return priceImpactPercent > maxImpactBps / 100;
}

export function decideSell(input: {
  rawAmount: bigint;
  outLamports: bigint;
  priceImpactPercent: number;
  maxImpactBps: number;
}): { sell: true } | { sell: false; reason: string } {
  if (input.rawAmount <= BigInt(0)) return { sell: false, reason: "none" };
  if (input.outLamports <= BigInt(0) || impactTooHigh(input.priceImpactPercent, input.maxImpactBps)) {
    if (input.outLamports <= BigInt(0) || !Number.isFinite(input.priceImpactPercent)) {
      return { sell: false, reason: "No exit to SOL. The token stayed in the wallet." };
    }
    return { sell: false, reason: "The sale would exceed the impact cap. The token stayed in the wallet." };
  }
  if (input.outLamports < BigInt(MIN_SELL_LAMPORTS)) {
    return { sell: false, reason: DUST_SELL_REASON };
  }
  return { sell: true };
}
