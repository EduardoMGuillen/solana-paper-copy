import { loadDecoderHistory } from "./datapi";
import { assembleReport, type MeteoraView } from "./history";

const WINDOW_DAYS = 90;
const CACHE_MS = 10 * 60 * 1000;

let cached: { at: number; view: MeteoraView } | null = null;

/** Paper Bid-Ask report over the last 90 daily closes. Cached so the page does not refetch on every poll. */
export async function meteoraPanel(now = Date.now(), refresh = false): Promise<MeteoraView> {
  if (!refresh && cached && now - cached.at < CACHE_MS) return cached.view;
  const history = await loadDecoderHistory(now, WINDOW_DAYS);
  const view = assembleReport({ now, windowDays: WINDOW_DAYS, ...history });
  cached = { at: now, view };
  return view;
}
