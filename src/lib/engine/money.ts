export function entryPrice(mark: number, slippageBps: number): number {
  return mark * (1 + slippageBps / 10_000);
}

export function exitPrice(mark: number, slippageBps: number): number {
  return mark * (1 - slippageBps / 10_000);
}

export function feeSol(notional: number, feeBps: number): number {
  return notional * (feeBps / 10_000);
}

export function exitProceeds(
  qty: number,
  mark: number,
  slippageBps: number,
  feeBps: number,
): { price: number; gross: number; fee: number; proceeds: number } {
  const price = exitPrice(mark, slippageBps);
  const gross = qty * price;
  const fee = feeSol(gross, feeBps);
  return { price, gross, fee, proceeds: gross - fee };
}

export function drawdownPct(peak: number, equity: number): number {
  if (!(peak > 0)) return 0;
  return Math.max(0, (peak - equity) / peak);
}

export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function emptyStats() {
  return {
    wins: 0,
    losses: 0,
    closed: 0,
    grossProfitSol: 0,
    grossLossSol: 0,
    maxDrawdown: 0,
  };
}

export function winRate(stats: { wins: number; closed: number }): number | null {
  if (stats.closed <= 0) return null;
  return stats.wins / stats.closed;
}

export function profitFactor(stats: {
  grossProfitSol: number;
  grossLossSol: number;
}): number | null {
  if (stats.grossLossSol <= 0) {
    return stats.grossProfitSol > 0 ? Number.POSITIVE_INFINITY : null;
  }
  return stats.grossProfitSol / stats.grossLossSol;
}
