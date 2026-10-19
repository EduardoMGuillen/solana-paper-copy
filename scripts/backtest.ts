/**
 * Backtest every strategy on every market with real public data.
 *   npm run backtest                 # 4h, 3000 bars
 *   npm run backtest -- 1d 1500      # interval and bar count
 */
import { walkForward } from "../src/lib/bot/backtest";
import { fetchCandles, MARKETS, type Interval } from "../src/lib/bot/market";
import { STRATEGY_IDS } from "../src/lib/bot/strategies";
import { defaultBotSettings } from "../src/lib/bot/settings";

const interval = (process.argv[2] as Interval) || "4h";
const bars = Number(process.argv[3]) || 3000;
const risk = Number(process.argv[4]) || defaultBotSettings.riskPerTrade;
const only = process.argv[5]?.split(",");
const pct = (v: number | null) => (v === null ? "   —  " : `${(v * 100).toFixed(1).padStart(6)}%`);
const num = (v: number | null) => (v === null ? "  —  " : !Number.isFinite(v) ? "  ∞  " : v.toFixed(2).padStart(5));

async function main() {
  const s = { ...defaultBotSettings, riskPerTrade: risk };
  console.log(`interval=${interval} bars=${bars} risk=${s.riskPerTrade} fee=${s.feeBps}bps slip=${s.slippageBps}bps`);
  console.log("market strategy    trades  win    PF   expR  ret      OOSret   maxDD   B&H     sharpe verdict");
  for (const market of MARKETS) {
    let fetched;
    try {
      fetched = await fetchCandles(market, interval, bars);
    } catch (error) {
      console.log(market.id, "no data", (error as Error).message);
      continue;
    }
    const days = (fetched.candles.at(-1)!.t - fetched.candles[0].t) / 86_400_000;
    for (const id of STRATEGY_IDS.filter((id) => !only || only.includes(id))) {
      const wf = walkForward(fetched.candles, id, {
        capital: 1000,
        costs: { feeBps: s.feeBps, slippageBps: s.slippageBps },
        sizing: { riskPerTrade: s.riskPerTrade, maxExposure: s.maxExposure },
      });
      const m = wf.full.metrics;
      console.log(
        `${market.id.padEnd(6)} ${id.padEnd(10)} ${String(m.trades).padStart(6)} ${pct(m.winRate)} ${num(m.profitFactor)} ${num(m.expectancyR)} ${pct(m.totalReturn)} ${pct(wf.outOfSample.totalReturn)} ${pct(m.maxDrawdown)} ${pct(m.buyHoldReturn)} ${num(m.sharpe)} ${wf.verdict.pass ? "PASA" : "no"} (${days.toFixed(0)}d)`,
      );
    }
  }
}

void main();
