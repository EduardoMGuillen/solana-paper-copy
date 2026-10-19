/**
 * Classic chart indicators. Every function returns an array aligned with its
 * input: index i only uses data up to and including bar i, and warmup bars are
 * NaN. That alignment is what keeps the backtester free of look-ahead.
 */

export type Candle = {
  /** Bar open time, ms since epoch. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` values. */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i += 1) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder smoothing, used by RSI, ATR and ADX. */
function wilder(values: number[], period: number, start: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  if (values.length < start + period) return out;
  let prev = 0;
  for (let i = start; i < start + period; i += 1) prev += values[i];
  prev /= period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i += 1) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: number[], period: number): number[] {
  const gains = new Array<number>(closes.length).fill(0);
  const losses = new Array<number>(closes.length).fill(0);
  for (let i = 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    gains[i] = Math.max(0, change);
    losses[i] = Math.max(0, -change);
  }
  const avgGain = wilder(gains, period, 1);
  const avgLoss = wilder(losses, period, 1);
  return avgGain.map((gain, i) => {
    const loss = avgLoss[i];
    if (!Number.isFinite(gain) || !Number.isFinite(loss)) return Number.NaN;
    if (loss === 0) return gain === 0 ? 50 : 100;
    return 100 - 100 / (1 + gain / loss);
  });
}

export function trueRange(candles: Candle[]): number[] {
  return candles.map((bar, i) => {
    if (i === 0) return bar.h - bar.l;
    const prevClose = candles[i - 1].c;
    return Math.max(bar.h - bar.l, Math.abs(bar.h - prevClose), Math.abs(bar.l - prevClose));
  });
}

export function atr(candles: Candle[], period: number): number[] {
  return wilder(trueRange(candles), period, 1);
}

/** Average Directional Index: trend strength regardless of direction. */
export function adx(candles: Candle[], period: number): number[] {
  const n = candles.length;
  const plusDm = new Array<number>(n).fill(0);
  const minusDm = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i += 1) {
    const up = candles[i].h - candles[i - 1].h;
    const down = candles[i - 1].l - candles[i].l;
    plusDm[i] = up > down && up > 0 ? up : 0;
    minusDm[i] = down > up && down > 0 ? down : 0;
  }
  const tr = wilder(trueRange(candles), period, 1);
  const plus = wilder(plusDm, period, 1);
  const minus = wilder(minusDm, period, 1);
  const dx = new Array<number>(n).fill(Number.NaN);
  let first = -1;
  for (let i = 0; i < n; i += 1) {
    if (!(tr[i] > 0)) continue;
    const pdi = (100 * plus[i]) / tr[i];
    const mdi = (100 * minus[i]) / tr[i];
    const sum = pdi + mdi;
    dx[i] = sum > 0 ? (100 * Math.abs(pdi - mdi)) / sum : 0;
    if (first < 0) first = i;
  }
  if (first < 0) return dx.map(() => Number.NaN);
  return wilder(dx.map((value) => (Number.isFinite(value) ? value : 0)), period, first);
}

/** Highest high over the `period` bars ending at i (inclusive). */
export function highest(values: number[], period: number): number[] {
  return values.map((_, i) => {
    if (i < period - 1) return Number.NaN;
    let max = Number.NEGATIVE_INFINITY;
    for (let j = i - period + 1; j <= i; j += 1) max = Math.max(max, values[j]);
    return max;
  });
}

export function lowest(values: number[], period: number): number[] {
  return values.map((_, i) => {
    if (i < period - 1) return Number.NaN;
    let min = Number.POSITIVE_INFINITY;
    for (let j = i - period + 1; j <= i; j += 1) min = Math.min(min, values[j]);
    return min;
  });
}

/**
 * Session VWAP, reset at 00:00 UTC (crypto has no exchange session).
 * Uses the typical price (h + l + c) / 3 weighted by volume.
 */
export function vwap(candles: Candle[]): number[] {
  const out = new Array<number>(candles.length).fill(Number.NaN);
  let day = -1;
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < candles.length; i += 1) {
    const bar = candles[i];
    const d = Math.floor(bar.t / 86_400_000);
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    const typical = (bar.h + bar.l + bar.c) / 3;
    pv += typical * bar.v;
    vol += bar.v;
    out[i] = vol > 0 ? pv / vol : typical;
  }
  return out;
}

/** Bars since the current UTC session opened (0 on the first bar of the day). */
export function sessionBar(candles: Candle[]): number[] {
  let day = -1;
  let n = 0;
  return candles.map((bar) => {
    const d = Math.floor(bar.t / 86_400_000);
    if (d !== day) {
      day = d;
      n = 0;
    } else n += 1;
    return n;
  });
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): { macd: number[]; signal: number[]; hist: number[] } {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const line = closes.map((_, i) => fastEma[i] - slowEma[i]);
  const firstValid = line.findIndex((value) => Number.isFinite(value));
  const signalLine = new Array<number>(closes.length).fill(Number.NaN);
  if (firstValid >= 0) {
    const tail = ema(line.slice(firstValid), signal);
    tail.forEach((value, j) => {
      signalLine[firstValid + j] = value;
    });
  }
  return {
    macd: line,
    signal: signalLine,
    hist: line.map((value, i) => value - signalLine[i]),
  };
}
