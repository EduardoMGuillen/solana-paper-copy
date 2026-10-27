/**
 * Meteora DLMM research (run on the VM or at home; some networks block meteora.ag).
 * Pool lists come from the DLMM Data API (`dlmm.datapi.meteora.ag`).
 *
 *   npm run meteora -- scan       # current SOL pools: fee/TVL distribution and the top candidates
 *   npm run meteora -- collect    # append one snapshot to data/meteora/YYYY-MM-DD.jsonl (the VM runs it every 15 min)
 *   npm run meteora -- report     # forward paper test of a Decoder-Farmer style Bid-Ask position on the snapshots
 */
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DECODER_SHAPE } from "../src/lib/lp/bidask";
import { fetchCurrentSnaps } from "../src/lib/lp/datapi";
import {
  DECODER_EXITS,
  DECODER_RULES,
  feeTvl24h,
  forwardTest,
  passes,
  type PoolSnap,
} from "../src/lib/lp/meteora";
import { dataDir } from "../src/lib/paths";

const dir = path.join(dataDir(), "meteora");
const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

async function fetchSnaps(): Promise<PoolSnap[]> {
  return fetchCurrentSnaps();
}

async function scan() {
  const snaps = await fetchSnaps();
  const candidates = snaps.filter((snap) => passes(snap, DECODER_RULES));
  console.log(`Visible SOL pools: ${snaps.length}. Passing the Decoder-style filter (TVL ≥ $10k, 24h fees ≥ $1k, base fee ≥ 1%, 1h volume ≥ $10k): ${candidates.length}\n`);
  const ratios = candidates.map(feeTvl24h).sort((a, b) => a - b);
  const q = (p: number) => ratios[Math.min(ratios.length - 1, Math.floor(p * ratios.length))] ?? 0;
  console.log(`Candidates' 24h fees / TVL: median ${pct(q(0.5))}, p25 ${pct(q(0.25))}, p75 ${pct(q(0.75))}, p90 ${pct(q(0.9))}`);
  console.log("(That is what the whole pool would earn in a day; your Bid-Ask position only earns while price is inside its range.)\n");
  console.log("pool                         TVL USD   fees24h/TVL    base fee  bin step");
  for (const snap of [...candidates].sort((a, b) => feeTvl24h(b) - feeTvl24h(a)).slice(0, 25)) {
    console.log(
      `${snap.name.slice(0, 26).padEnd(26)} ${Math.round(snap.tvl).toLocaleString("en-US").padStart(10)}   ${pct(feeTvl24h(snap)).padStart(10)}   ${String(snap.baseFeePct).padStart(6)}%  ${String(snap.binStep).padStart(6)}`,
    );
  }
}

async function collect() {
  const snaps = (await fetchSnaps()).filter((snap) => snap.tvl >= 2_000 && snap.fees24h >= 100);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  await appendFile(file, snaps.map((snap) => JSON.stringify(snap)).join("\n") + "\n");
  console.log(`${new Date().toISOString()} ${snaps.length} pools saved to ${file}`);
}

async function report() {
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl")).sort();
  } catch {
    // no data yet
  }
  const snaps: PoolSnap[] = [];
  for (const name of files) {
    for (const line of (await readFile(path.join(dir, name), "utf8")).split("\n")) {
      if (!line.trim()) continue;
      try {
        snaps.push(JSON.parse(line) as PoolSnap);
      } catch {
        // skip a torn line
      }
    }
  }
  if (snaps.length === 0) {
    console.log(`No snapshots in ${dir}. Run "collect" every 15 min for at least 2-3 days.`);
    return;
  }
  const times = [...new Set(snaps.map((s) => s.t))].sort((a, b) => a - b);
  const days = (times.at(-1)! - times[0]) / 86_400_000;
  console.log(`${times.length} snapshots over ${days.toFixed(1)} days, ${new Set(snaps.map((s) => s.address)).size} pools.\n`);

  for (const exits of [DECODER_EXITS, { ...DECODER_EXITS, stopLoss: 0.1 }, { ...DECODER_EXITS, holdHours: 72 }]) {
    const r = forwardTest(snaps, DECODER_RULES, DECODER_SHAPE, exits);
    console.log(`Bid-Ask SOL -75%, TP ${pct(exits.takeProfit, 0)}, stop ${pct(exits.stopLoss, 0)}, max ${exits.holdHours} h:`);
    if (r.trades.length === 0) {
      console.log("  No complete positions yet; more history needed.\n");
      continue;
    }
    const reasons = new Map<string, number>();
    for (const trade of r.trades) reasons.set(trade.reason, (reasons.get(trade.reason) ?? 0) + 1);
    console.log(`  positions ${r.trades.length} · winners ${pct(r.winRate, 0)} · mean ${pct(r.mean, 2)} · median ${pct(r.median, 2)} · worst ${pct(r.worst)}`);
    console.log(`  token fell > 60% while the position was open: ${pct(r.crashRate)} of the time`);
    console.log(`  exits: ${[...reasons].map(([k, v]) => `${k} ${v}`).join(", ")}`);
    console.log(`  estimated fees (optimistic) average per position: ${pct(r.trades.reduce((s, t) => s + t.fees, 0) / r.trades.length, 2)}\n`);
  }
  console.log("Fees are an optimistic upper bound: if the mean comes out negative, the strategy really loses.");
}

const command = process.argv[2] ?? "scan";
const run = { scan, collect, report }[command as "scan" | "collect" | "report"];
if (!run) {
  console.log("Usage: npm run meteora -- scan | collect | report");
  process.exit(1);
}
run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
