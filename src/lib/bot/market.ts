import type { Candle } from "./indicators";

/**
 * Keyless public market data. Binance's market-data mirror is the primary
 * source (deep history, every Solana-ecosystem pair); Coinbase is the
 * fallback for SOL, BTC and ETH.
 */

export type Interval = "3m" | "15m" | "1h" | "4h" | "1d";

export const INTERVALS: Interval[] = ["3m", "15m", "1h", "4h", "1d"];

export function isInterval(value: unknown): value is Interval {
  return typeof value === "string" && (INTERVALS as string[]).includes(value);
}

export const INTERVAL_MS: Record<Interval, number> = {
  "3m": 3 * 60_000,
  "15m": 15 * 60_000,
  "1h": 3_600_000,
  "4h": 4 * 3_600_000,
  "1d": 24 * 3_600_000,
};

export type Market = {
  id: string;
  symbol: string;
  /** Binance pair. */
  binance: string;
  /** Coinbase product, when listed. */
  coinbase?: string;
};

/** Liquid Solana-ecosystem tokens plus SOL itself. All tradable on Jupiter. */
export const MARKETS: Market[] = [
  { id: "SOL", symbol: "SOL", binance: "SOLUSDT", coinbase: "SOL-USD" },
  { id: "JUP", symbol: "JUP", binance: "JUPUSDT" },
  { id: "JTO", symbol: "JTO", binance: "JTOUSDT" },
  { id: "RAY", symbol: "RAY", binance: "RAYUSDT" },
  { id: "BONK", symbol: "BONK", binance: "BONKUSDT" },
  { id: "WIF", symbol: "WIF", binance: "WIFUSDT" },
  { id: "PYTH", symbol: "PYTH", binance: "PYTHUSDT" },
  { id: "BTC", symbol: "BTC", binance: "BTCUSDT", coinbase: "BTC-USD" },
  { id: "ETH", symbol: "ETH", binance: "ETHUSDT", coinbase: "ETH-USD" },
];

export function marketById(id: string): Market | undefined {
  return MARKETS.find((market) => market.id === id);
}

const BINANCE = process.env.BINANCE_DATA_URL || "https://data-api.binance.vision";

type BinanceKline = [number, string, string, string, string, string, number, ...unknown[]];

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!response.ok) throw new Error(`${new URL(url).host} respondió ${response.status}`);
  return (await response.json()) as T;
}

function parseBinance(rows: BinanceKline[]): Candle[] {
  return rows.map((row) => ({
    t: row[0],
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    v: Number(row[5]),
  }));
}

async function binanceCandles(pair: string, interval: Interval, bars: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let endTime: number | undefined;
  while (out.length < bars) {
    const limit = Math.min(1000, bars - out.length);
    const url = `${BINANCE}/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}${endTime ? `&endTime=${endTime}` : ""}`;
    const page = parseBinance(await getJson<BinanceKline[]>(url));
    if (page.length === 0) break;
    out.unshift(...page);
    endTime = page[0].t - 1;
    if (page.length < limit) break;
  }
  return out;
}

async function coinbaseCandles(product: string, interval: Interval, bars: number): Promise<Candle[]> {
  // Coinbase has 1h and 1d, not 4h; 4h is built from 1h bars.
  const granularity = interval === "1d" ? 86_400 : 3_600;
  const factor = interval === "4h" ? 4 : 1;
  const need = bars * factor;
  const byT = new Map<number, Candle>();
  let end = Math.floor(Date.now() / 1000);
  while (byT.size < need) {
    const start = end - granularity * 300;
    const url = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${granularity}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
    const rows = await getJson<[number, number, number, number, number, number][]>(url);
    if (rows.length === 0) break;
    for (const [t, l, h, o, c, v] of rows) byT.set(t * 1000, { t: t * 1000, o, h, l, c, v });
    end = start;
  }
  const hourly = [...byT.values()].sort((a, b) => a.t - b.t);
  if (factor === 1) return hourly.slice(-bars);
  const step = INTERVAL_MS["4h"];
  const grouped = new Map<number, Candle>();
  for (const bar of hourly) {
    const key = Math.floor(bar.t / step) * step;
    const prev = grouped.get(key);
    grouped.set(
      key,
      prev
        ? { t: key, o: prev.o, h: Math.max(prev.h, bar.h), l: Math.min(prev.l, bar.l), c: bar.c, v: prev.v + bar.v }
        : { ...bar, t: key },
    );
  }
  return [...grouped.values()].slice(-bars);
}

/** Binance spot price, or null when the body is not a positive number. */
export function parseTickerPrice(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const price = Number((body as { price?: unknown }).price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** Latest SOL/USDT. Null on a network or parse failure so the page can still show SOL. */
export async function fetchSolUsd(): Promise<number | null> {
  try {
    return parseTickerPrice(await getJson<unknown>(`${BINANCE}/api/v3/ticker/price?symbol=SOLUSDT`));
  } catch {
    return null;
  }
}

export type CandleFetch = { candles: Candle[]; source: string };

export async function fetchCandles(market: Market, interval: Interval, bars: number): Promise<CandleFetch> {
  try {
    return { candles: await binanceCandles(market.binance, interval, bars), source: "Binance" };
  } catch (error) {
    // Coinbase has no 3m bars here; intraday frames depend on Binance.
    if (!market.coinbase || interval === "3m" || interval === "15m") throw error;
    return { candles: await coinbaseCandles(market.coinbase, interval, bars), source: "Coinbase" };
  }
}

/** Drop the still-forming last bar. Decisions only use closed bars. */
export function closedOnly(candles: Candle[], interval: Interval, now: number): Candle[] {
  const last = candles[candles.length - 1];
  if (last && last.t + INTERVAL_MS[interval] > now) return candles.slice(0, -1);
  return candles;
}
