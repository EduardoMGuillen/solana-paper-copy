/**
 * Shadow mode: measure what each paper trade would really cost on Jupiter.
 *
 * For every paper fill (and an hourly probe per market), ask Jupiter for a
 * quote of the same size and compare its effective price with the Binance
 * price the bot used. The gap, in basis points per side, includes pool fees,
 * price impact and routing; it is what the backtest models as fee + slippage.
 */

export type ShadowQuote = {
  t: number;
  market: string;
  kind: "trade" | "probe";
  side: "buy" | "sell";
  usd: number;
  /** Binance price the bot was using. */
  mark: number;
  /** USD per token implied by the Jupiter quote. */
  effPrice: number;
  /** Real cost against the mark, per side. Positive = worse than the mark. */
  costBps: number;
  priceImpactPct: number | null;
  router: string | null;
  /** Jupiter and Binance disagree by over 20%: likely a wrong mint, excluded from stats. */
  suspicious: boolean;
};

export type ShadowState = {
  quotes: ShadowQuote[];
  lastProbe: Record<string, number>;
  decimals: Record<string, number>;
  error: string | null;
  lastOkAt: number | null;
};

export const SHADOW_CAP = 600;
export const PROBE_MS = 60 * 60_000;
const SUSPICIOUS = 0.2;

export function emptyShadow(): ShadowState {
  return { quotes: [], lastProbe: {}, decimals: {}, error: null, lastOkAt: null };
}

/** USD per token from raw amounts. */
export function effectivePrice(side: "buy" | "sell", inRaw: number, outRaw: number, tokenDecimals: number, usdDecimals = 6): number {
  const usd = (side === "buy" ? inRaw : outRaw) / 10 ** usdDecimals;
  const tokens = (side === "buy" ? outRaw : inRaw) / 10 ** tokenDecimals;
  return tokens > 0 ? usd / tokens : Number.NaN;
}

export function costBps(side: "buy" | "sell", mark: number, effPrice: number): number {
  return side === "buy" ? (effPrice / mark - 1) * 10_000 : (1 - effPrice / mark) * 10_000;
}

export function isSuspicious(mark: number, effPrice: number): boolean {
  return !(effPrice > 0) || Math.abs(effPrice / mark - 1) > SUSPICIOUS;
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export type ShadowRow = {
  market: string;
  n: number;
  buyMedian: number | null;
  sellMedian: number | null;
  p90: number | null;
  suspicious: number;
};

export function summarizeShadow(quotes: ShadowQuote[]): ShadowRow[] {
  const markets = [...new Set(quotes.map((q) => q.market))];
  return markets.map((market) => {
    const mine = quotes.filter((q) => q.market === market);
    const clean = mine.filter((q) => !q.suspicious);
    return {
      market,
      n: clean.length,
      buyMedian: quantile(clean.filter((q) => q.side === "buy").map((q) => q.costBps), 0.5),
      sellMedian: quantile(clean.filter((q) => q.side === "sell").map((q) => q.costBps), 0.5),
      p90: quantile(clean.map((q) => q.costBps), 0.9),
      suspicious: mine.length - clean.length,
    };
  });
}

/** Verdict against the backtest's assumed cost per side (fee + slippage). */
export function shadowVerdict(rows: ShadowRow[], assumedBps: number): { ok: boolean; text: string } | null {
  const medians = rows.flatMap((r) => [r.buyMedian, r.sellMedian]).filter((v): v is number => v !== null);
  if (medians.length === 0) return null;
  const worst = Math.max(...medians);
  return worst <= assumedBps
    ? { ok: true, text: `Costo real ≤ el supuesto del backtest (${assumedBps} bps por lado) en todos los mercados medidos.` }
    : {
        ok: false,
        text: `El peor mercado cuesta ${worst.toFixed(0)} bps por lado y el backtest supone ${assumedBps}. Sube comisión + deslizamiento en Ajustes y vuelve a validar.`,
      };
}
