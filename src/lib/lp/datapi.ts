import { decoderFilter, parsePairs, toSnap, WSOL, type PoolSnap, type RawPair } from "./meteora";
import { historySnaps, keepOnePoolPerName, type HistoryCandle, type PoolMeta, type VolumeBucket } from "./history";

/** Current DLMM Data API. The retired host `dlmm-api.meteora.ag` answers 404. */
export const METEORA_DATA_API = process.env.METEORA_DATA_API_URL || "https://dlmm.datapi.meteora.ag";

const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Meteora returned ${response.status}`);
  return response.json();
}

/** Pages of `/pools`. Stops after five pages so a filter mistake cannot pull the whole protocol. */
export async function listPools(filter: string, query = "SOL"): Promise<RawPair[]> {
  const pools: RawPair[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const url = new URL("/pools", METEORA_DATA_API);
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", "100");
    url.searchParams.set("sort_by", "tvl:desc");
    url.searchParams.set("filter_by", filter);
    if (query) url.searchParams.set("query", query);
    const body = await getJson(url.toString());
    pools.push(...parsePairs(body));
    const pages = body && typeof body === "object" && "pages" in body ? num((body as { pages: unknown }).pages) : page;
    if (!Number.isFinite(pages) || page >= pages) break;
  }
  return pools;
}

/** One pool, for marking an open paper position without listing the whole protocol. */
export async function fetchPoolSnap(address: string, now = Date.now()): Promise<PoolSnap | null> {
  const body = await getJson(new URL(`/pools/${address}`, METEORA_DATA_API).toString());
  const pair = body && typeof body === "object" && "address" in body ? (body as RawPair) : null;
  return pair ? toSnap(pair, now) : null;
}

/** Current SOL pools loose enough for the collector. The scan applies Decoder rules afterwards. */
export async function fetchCurrentSnaps(now = Date.now()): Promise<PoolSnap[]> {
  const pairs = await listPools("tvl>=2000&&fee_24h>=100&&is_blacklisted=false");
  const snaps = pairs.map((pair) => toSnap(pair, now)).filter((snap): snap is PoolSnap => snap !== null);
  return keepOnePoolPerName(snaps);
}

export function poolMeta(pair: RawPair): PoolMeta | null {
  const snap = toSnap(pair, 0);
  if (!snap) return null;
  const mintY = pair.mint_y ?? pair.token_y?.address;
  return {
    address: snap.address,
    name: snap.name,
    solIsY: mintY === WSOL,
    tvl: snap.tvl,
    binStep: snap.binStep,
    baseFeePct: snap.baseFeePct,
  };
}

export function parseCandles(body: unknown): HistoryCandle[] {
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) return [];
  const candles: HistoryCandle[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const timestamp = num((row as { timestamp?: unknown }).timestamp);
    const close = num((row as { close?: unknown }).close);
    if (timestamp > 0 && close > 0) candles.push({ timestamp, close });
  }
  return candles;
}

export function parseVolumes(body: unknown): VolumeBucket[] {
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) return [];
  const buckets: VolumeBucket[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const timestamp = num((row as { timestamp?: unknown }).timestamp);
    const volume = num((row as { volume?: unknown }).volume);
    const fees = num((row as { fees?: unknown }).fees);
    if (timestamp > 0 && Number.isFinite(volume) && Number.isFinite(fees)) buckets.push({ timestamp, volume, fees });
  }
  return buckets;
}

export async function fetchPoolSeries(address: string, start: number, end: number): Promise<{ candles: HistoryCandle[]; volumes: VolumeBucket[] }> {
  const ohlcv = new URL(`/pools/${address}/ohlcv`, METEORA_DATA_API);
  const volume = new URL(`/pools/${address}/volume/history`, METEORA_DATA_API);
  for (const url of [ohlcv, volume]) {
    url.searchParams.set("timeframe", "24h");
    url.searchParams.set("start_time", String(start));
    url.searchParams.set("end_time", String(end));
  }
  const [candlesBody, volumeBody] = await Promise.all([getJson(ohlcv.toString()), getJson(volume.toString())]);
  return { candles: parseCandles(candlesBody), volumes: parseVolumes(volumeBody) };
}

export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await fn(items[index]);
    }
  });
  await Promise.all(workers);
}

/** Daily series for pools that pass the Decoder screen right now. Capped so the page stays bounded. */
export async function loadDecoderHistory(now = Date.now(), windowDays = 90, maxPools = 40): Promise<{
  poolsSeen: number;
  poolsWithHistory: number;
  failed: number;
  snaps: PoolSnap[];
}> {
  const listed = await listPools(decoderFilter());
  const current = listed.map((pair) => toSnap(pair, now)).filter((snap): snap is PoolSnap => snap !== null);
  const chosen = new Set(keepOnePoolPerName(current).map((snap) => snap.address));
  const metas = listed
    .map(poolMeta)
    .filter((meta): meta is PoolMeta => meta !== null && chosen.has(meta.address))
    .slice(0, maxPools);
  const end = Math.floor(now / 1000);
  const start = end - windowDays * 86_400;
  const snaps: PoolSnap[] = [];
  let poolsWithHistory = 0;
  let failed = 0;
  await mapLimit(metas, 4, async (meta) => {
    try {
      const series = await fetchPoolSeries(meta.address, start, end);
      const rows = historySnaps(meta, series.candles, series.volumes);
      if (rows.length >= 2) {
        poolsWithHistory += 1;
        snaps.push(...rows);
      }
    } catch {
      failed += 1;
    }
  });
  return { poolsSeen: metas.length, poolsWithHistory, failed, snaps };
}
