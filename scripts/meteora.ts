/**
 * Meteora DLMM research (run on the VM or at home; some networks block meteora.ag).
 *
 *   npm run meteora -- scan       # current SOL pools: fee/TVL distribution and the top candidates
 *   npm run meteora -- collect    # append one snapshot to data/meteora/YYYY-MM-DD.jsonl (the VM runs it every 15 min)
 *   npm run meteora -- report     # forward paper test of a Decoder-Farmer style Bid-Ask position on the snapshots
 */
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DECODER_SHAPE } from "../src/lib/lp/bidask";
import {
  DECODER_EXITS,
  DECODER_RULES,
  feeTvl24h,
  forwardTest,
  METEORA_API,
  parsePairs,
  passes,
  toSnap,
  type PoolSnap,
} from "../src/lib/lp/meteora";
import { dataDir } from "../src/lib/paths";

const dir = path.join(dataDir(), "meteora");
const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

async function fetchSnaps(): Promise<PoolSnap[]> {
  const response = await fetch(`${METEORA_API}/pair/all`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Meteora respondió ${response.status}`);
  const t = Date.now();
  return parsePairs(await response.json())
    .map((pair) => toSnap(pair, t))
    .filter((snap): snap is PoolSnap => snap !== null);
}

async function scan() {
  const snaps = await fetchSnaps();
  const candidates = snaps.filter((snap) => passes(snap, DECODER_RULES));
  console.log(`Pools con SOL visibles: ${snaps.length}. Pasan el filtro tipo Decoder (TVL ≥ 10k US$, comisiones 24h ≥ 1k US$, base fee ≥ 1%, volumen 1h ≥ 10k US$): ${candidates.length}\n`);
  const ratios = candidates.map(feeTvl24h).sort((a, b) => a - b);
  const q = (p: number) => ratios[Math.min(ratios.length - 1, Math.floor(p * ratios.length))] ?? 0;
  console.log(`Comisiones 24h / TVL de los candidatos: mediana ${pct(q(0.5))}, p25 ${pct(q(0.25))}, p75 ${pct(q(0.75))}, p90 ${pct(q(0.9))}`);
  console.log("(Es lo que cobraría el pool completo en un día; tu posición Bid-Ask solo cobra mientras el precio esté dentro de su rango.)\n");
  console.log("pool                         TVL US$   comis.24h/TVL  base fee  bin step");
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
  console.log(`${new Date().toISOString()} ${snaps.length} pools guardados en ${file}`);
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
    console.log(`No hay fotos en ${dir}. Corre "collect" cada 15 min al menos 2-3 días.`);
    return;
  }
  const times = [...new Set(snaps.map((s) => s.t))].sort((a, b) => a - b);
  const days = (times.at(-1)! - times[0]) / 86_400_000;
  console.log(`${times.length} fotos en ${days.toFixed(1)} días, ${new Set(snaps.map((s) => s.address)).size} pools.\n`);

  for (const exits of [DECODER_EXITS, { ...DECODER_EXITS, stopLoss: 0.1 }, { ...DECODER_EXITS, holdHours: 72 }]) {
    const r = forwardTest(snaps, DECODER_RULES, DECODER_SHAPE, exits);
    console.log(`Bid-Ask SOL -75%, TP ${pct(exits.takeProfit, 0)}, stop ${pct(exits.stopLoss, 0)}, máx ${exits.holdHours} h:`);
    if (r.trades.length === 0) {
      console.log("  Aún no hay posiciones completas; hace falta más historia.\n");
      continue;
    }
    const reasons = new Map<string, number>();
    for (const trade of r.trades) reasons.set(trade.reason, (reasons.get(trade.reason) ?? 0) + 1);
    console.log(`  posiciones ${r.trades.length} · ganadoras ${pct(r.winRate, 0)} · media ${pct(r.mean, 2)} · mediana ${pct(r.median, 2)} · peor ${pct(r.worst)}`);
    console.log(`  token cayó > 60% con la posición abierta: ${pct(r.crashRate)} de las veces`);
    console.log(`  salidas: ${[...reasons].map(([k, v]) => `${k} ${v}`).join(", ")}`);
    console.log(`  comisiones estimadas (optimistas) promedio por posición: ${pct(r.trades.reduce((s, t) => s + t.fees, 0) / r.trades.length, 2)}\n`);
  }
  console.log("Las comisiones son una cota optimista: si la media sale negativa, la estrategia pierde de verdad.");
}

const command = process.argv[2] ?? "scan";
const run = { scan, collect, report }[command as "scan" | "collect" | "report"];
if (!run) {
  console.log("Uso: npm run meteora -- scan | collect | report");
  process.exit(1);
}
run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
