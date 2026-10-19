import { addLog, bookEquity, type BotState } from "../bot/engine";
import { getDecimals, getQuote, type JupiterConfig } from "./jupiter";
import {
  costBps,
  effectivePrice,
  emptyShadow,
  isSuspicious,
  PROBE_MS,
  SHADOW_CAP,
  type ShadowQuote,
} from "./shadow";
import { MARKET_TOKENS, USDC } from "./tokens";

export type ShadowJob = { market: string; kind: "trade" | "probe"; side: "buy" | "sell"; usd: number; mark: number };

/**
 * Take the queued paper fills and the hourly probes that are due.
 * Called under the state lock; marks probes as attempted so a failing
 * Jupiter is not hammered every tick.
 */
export function planShadowJobs(state: BotState, now: number): ShadowJob[] {
  state.shadow ??= emptyShadow();
  const markOf = (market: string) => state.books.find((b) => b.id === market)?.lastPrice ?? null;
  const jobs: ShadowJob[] = [];
  for (const fill of state.fillQueue ?? []) {
    const mark = markOf(fill.market) ?? fill.paperPrice;
    if (MARKET_TOKENS[fill.market] && fill.usd > 0 && mark > 0) {
      jobs.push({ market: fill.market, kind: "trade", side: fill.side, usd: fill.usd, mark });
    }
  }
  state.fillQueue = [];
  for (const book of state.books) {
    const mark = book.lastPrice;
    if (!mark || !MARKET_TOKENS[book.id]) continue;
    if (now - (state.shadow.lastProbe[book.id] ?? 0) < PROBE_MS) continue;
    state.shadow.lastProbe[book.id] = now;
    // Probe at the size a full-exposure trade would have now.
    const usd = Math.max(5, bookEquity(state, book) * state.settings.maxExposure);
    jobs.push({ market: book.id, kind: "probe", side: "buy", usd, mark }, { market: book.id, kind: "probe", side: "sell", usd, mark });
  }
  return jobs;
}

/** "fetch failed" alone says nothing; include the network cause (DNS, TLS, refused, timeout). */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
  const detail = cause?.code ?? cause?.message;
  return detail ? `${error.message} (${detail})` : error.message;
}

export type ShadowOutcome ={ quotes: ShadowQuote[]; decimals: Record<string, number>; errors: string[] };

/** Network part. Never signs: quotes are requested without a taker. */
export async function runShadowJobs(
  jobs: ShadowJob[],
  config: JupiterConfig,
  knownDecimals: Record<string, number>,
  now: () => number = Date.now,
): Promise<ShadowOutcome> {
  const decimals = { ...knownDecimals };
  const quotes: ShadowQuote[] = [];
  const errors: string[] = [];
  for (const job of jobs) {
    const token = MARKET_TOKENS[job.market];
    try {
      if (decimals[token.mint] === undefined) {
        decimals[token.mint] = await getDecimals(token.mint).catch(() => token.decimals);
      }
      const dec = decimals[token.mint];
      const request =
        job.side === "buy"
          ? { inputMint: USDC.mint, outputMint: token.mint, amount: job.usd * 10 ** USDC.decimals }
          : { inputMint: token.mint, outputMint: USDC.mint, amount: (job.usd / job.mark) * 10 ** dec };
      const q = await getQuote(config, request);
      const effPrice = effectivePrice(job.side, q.inAmount, q.outAmount, dec, USDC.decimals);
      quotes.push({
        t: now(),
        market: job.market,
        kind: job.kind,
        side: job.side,
        usd: job.usd,
        mark: job.mark,
        effPrice,
        costBps: costBps(job.side, job.mark, effPrice),
        priceImpactPct: q.priceImpactPct,
        router: q.router,
        suspicious: isSuspicious(job.mark, effPrice),
      });
    } catch (error) {
      errors.push(`${job.market}: ${describe(error)}`);
    }
  }
  return { quotes, decimals, errors };
}

/** Store the outcome; alert when a real trade would cost far more than the backtest assumes. */
export function applyShadowOutcome(state: BotState, outcome: ShadowOutcome, now: number): void {
  state.shadow ??= emptyShadow();
  const shadow = state.shadow;
  shadow.decimals = outcome.decimals;
  shadow.quotes = [...shadow.quotes, ...outcome.quotes].slice(-SHADOW_CAP);
  if (outcome.quotes.length > 0) shadow.lastOkAt = now;
  const suspicious = outcome.quotes.filter((q) => q.suspicious);
  shadow.error =
    outcome.errors[0] ??
    (suspicious.length > 0
      ? `Precio de ${suspicious[0].market} en Jupiter difiere más de 20% de Binance: revisa su mint en src/lib/exec/tokens.ts.`
      : null);

  const assumed = state.settings.feeBps + state.settings.slippageBps;
  for (const q of outcome.quotes) {
    if (q.kind !== "trade" || q.suspicious) continue;
    const text = `Sombra: ${q.side === "buy" ? "compra" : "venta"} de ${q.usd.toFixed(2)} US$ costaría ${q.costBps.toFixed(0)} bps reales (supuesto ${assumed}).`;
    addLog(state, now, q.market, text, q.costBps > 2 * assumed ? "warn" : "info", q.costBps > 2 * assumed);
  }
}
