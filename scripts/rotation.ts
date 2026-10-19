/**
 * Research for the aggressive momentum-rotation mode.
 *   npm run rotation              # grid search, walk-forward, cost 0.15% per side
 *   npm run rotation -- 25 20     # fee and slippage in bps per side
 *
 * Parameters are chosen on the in-sample years only, then shown on the
 * out-of-sample years. Results are also expressed in SOL: the bot has to
 * beat simply holding the SOL you started with.
 */
import type { Candle } from "../src/lib/bot/indicators";
import { buildPanel, simulateRotation, type Panel, type RotationParams } from "../src/lib/bot/rotation";
import { ROTATION_UNIVERSE } from "../src/lib/bot/universe";

const feeBps = Number(process.argv[2] ?? 10);
const slippageBps = Number(process.argv[3] ?? 5);
const costs = { feeBps, slippageBps };
const SPLIT = Date.UTC(2025, 0, 1);
const START = Date.UTC(2022, 0, 1);
const YEAR = 365 * 86_400_000;

async function daily(pair: string): Promise<Candle[]> {
  const out: Candle[] = [];
  let startTime = Date.UTC(2020, 0, 1);
  for (;;) {
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${pair}&interval=1d&limit=1000&startTime=${startTime}`;
    const rows = (await (await fetch(url)).json()) as [number, string, string, string, string, string][];
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) out.push({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] });
    if (rows.length < 1000) break;
    startTime = rows[rows.length - 1][0] + 1;
  }
  // Drop today's forming bar.
  return out.filter((c) => c.t + 86_400_000 <= Date.now());
}

function stats(curve: { t: number; equity: number }[], solClose: (t: number) => number) {
  const v = curve.map((p) => p.equity);
  let peak = -Infinity;
  let dd = 0;
  for (const x of v) {
    peak = Math.max(peak, x);
    dd = Math.max(dd, (peak - x) / peak);
  }
  const rets = v.slice(1).map((x, i) => x / v[i] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  const years = (curve.at(-1)!.t - curve[0].t) / YEAR;
  const total = v.at(-1)! / v[0] - 1;
  const solStart = v[0] / solClose(curve[0].t);
  const solEnd = v.at(-1)! / solClose(curve.at(-1)!.t);
  return {
    total,
    cagr: (1 + total) ** (1 / years) - 1,
    dd,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(365) : 0,
    /** Growth measured in SOL: >0 means it beat holding SOL. */
    vsSol: solEnd / solStart - 1,
  };
}

function grid(): RotationParams[] {
  const out: RotationParams[] = [];
  for (const lookback of [7, 14, 30, 60])
    for (const top of [1, 2, 3])
      for (const trendEma of [0, 20, 50])
        for (const btcSma of [0, 50, 100])
          for (const trail of [0, 0.25])
            out.push({ lookback, top, trendEma, btcSma, buffer: 1, trail });
  return out;
}

const label = (p: RotationParams) =>
  `L${p.lookback} top${p.top} ema${p.trendEma} btc${p.btcSma} trail${p.trail}`;

const pct = (x: number) => `${(x * 100).toFixed(0).padStart(5)}%`;

async function main() {
  const series: Record<string, Candle[]> = {};
  for (const m of [...ROTATION_UNIVERSE, { symbol: "BTC", binance: "BTCUSDT" }]) {
    series[m.symbol] = await daily(m.binance);
  }
  const panel: Panel = buildPanel(series, (s) => s !== "BTC");
  const sol = panel.symbols.indexOf("SOL");
  const solClose = (t: number) => panel.close[sol][panel.times.indexOf(t)];
  const from = panel.times.findIndex((t) => t >= START);
  const split = panel.times.findIndex((t) => t >= SPLIT);
  const to = panel.times.length - 1;
  console.log(`Universo: ${panel.symbols.filter((_, s) => panel.tradable[s]).join(", ")}`);
  console.log(`En muestra ${new Date(START).toISOString().slice(0, 10)} → 2024-12-31 · fuera de muestra 2025-01-01 → ${new Date(panel.times[to]).toISOString().slice(0, 10)} · costo ${feeBps}+${slippageBps} bps por lado\n`);

  const results = grid().map((params) => {
    const run = (a: number, b: number) => simulateRotation(panel, params, { capital: 100, costs, from: a, to: b });
    const is = run(from, split - 1);
    const oos = run(split, to);
    return { params, is: stats(is.equity, solClose), oos: stats(oos.equity, solClose), oosTrades: oos.trades.length, oosExposure: oos.exposure };
  });

  // Choose on in-sample Sharpe only.
  const ranked = [...results].sort((a, b) => b.is.sharpe - a.is.sharpe);
  console.log("Top 10 por Sharpe EN MUESTRA, y cómo les fue FUERA de muestra:");
  console.log("parámetros                         | IS anual  IS DD | OOS total  OOS anual  OOS DD  vs SOL  sharpe ops");
  for (const r of ranked.slice(0, 10)) {
    console.log(
      `${label(r.params).padEnd(34)} | ${pct(r.is.cagr)} ${pct(r.is.dd)} | ${pct(r.oos.total)}   ${pct(r.oos.cagr)}  ${pct(r.oos.dd)} ${pct(r.oos.vsSol)}  ${r.oos.sharpe.toFixed(2).padStart(5)} ${String(r.oosTrades).padStart(4)}`,
    );
  }

  const positive = results.filter((r) => r.oos.total > 0).length;
  console.log(`\nRobustez: ${positive} de ${results.length} combinaciones ganan fuera de muestra.`);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log(`Mediana OOS de todas las combinaciones: ${pct(median(results.map((r) => r.oos.total)))} total, DD ${pct(median(results.map((r) => r.oos.dd)))}`);

  // Benchmarks on the out-of-sample window.
  const hold = (symbol: string) => {
    const s = panel.symbols.indexOf(symbol);
    return stats(panel.times.slice(split).map((t, k) => ({ t, equity: panel.close[s][split + k] })), solClose);
  };
  for (const s of ["SOL", "BTC"]) {
    const h = hold(s);
    console.log(`Comprar y mantener ${s} fuera de muestra: ${pct(h.total)} total, DD ${pct(h.dd)}`);
  }
}

void main();
