import {
  addLog,
  applySettings,
  applyValidation,
  closeMarket,
  createBotState,
  markAccount,
  onCandles,
  setHalt,
  validateMarket,
  validationDue,
  type BotState,
} from "./bot/engine";
import type { Candle } from "./bot/indicators";
import { fetchCandles, marketById, type Interval } from "./bot/market";
import { clampBotSettings, PROFILES, type BotSettings, type ProfileId } from "./bot/settings";
import { toView, type BotView } from "./bot/view";
import { jupiterConfig } from "./exec/jupiter";
import { applyShadowOutcome, planShadowJobs, runShadowJobs } from "./exec/runner";
import { emptyShadow } from "./exec/shadow";
import { formatAlerts, logSeq, pendingAlerts, sendTelegram, telegramConfig } from "./notify/telegram";
import { kickMeteoraForward } from "./lp/forward";
import { loadState, saveState } from "./store";

const POLL_MS = 30_000;
const LIVE_BARS = 600;
// Intraday frames need many more bars to cover a meaningful span (3m: ~70 days).
const VALIDATION_BARS: Record<Interval, number> = { "3m": 34_000, "15m": 20_000, "1h": 8_000, "4h": 6_000, "1d": 2_000 };

const g = globalThis as unknown as {
  __botQueue?: Promise<unknown>;
  __botState?: BotState;
  __botLoop?: ReturnType<typeof setInterval>;
  __botTicking?: boolean;
  /** Latest candles per market, for the charts. Memory only. */
  __botCandles?: Map<string, Candle[]>;
};

function candleCache(): Map<string, Candle[]> {
  g.__botCandles ??= new Map();
  return g.__botCandles;
}

async function solPriceNow(): Promise<number | null> {
  try {
    const { candles } = await fetchCandles(marketById("SOL")!, "1h", 2);
    return candles.at(-1)?.c ?? null;
  } catch {
    return null;
  }
}

async function freshState(settings: BotSettings = clampBotSettings(null)): Promise<BotState> {
  return createBotState(Date.now(), settings, await solPriceNow());
}

/** Serialize every read-modify-write of the state. */
export function withState<T>(fn: (state: BotState) => Promise<T> | T): Promise<T> {
  const previous = g.__botQueue ?? Promise.resolve();
  const job = previous.then(async () => {
    if (!g.__botState) {
      g.__botState = await loadState(() => freshState());
      // First run with alerts: start from now, do not replay the old log.
      g.__botState.notifiedSeq ??= g.__botState.seq;
    }
    return fn(g.__botState);
  });
  g.__botQueue = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Error de red";
}

/** Alert once when a market loses its data feed, not on every failed poll. */
function setBookError(state: BotState, book: BotState["books"][number], error: string): void {
  if (!book.error) addLog(state, Date.now(), book.id, `Sin datos de mercado: ${error}`, "warn");
  book.error = error;
}

/**
 * Shadow mode (LIVE_MODE=shadow + JUPITER_API_KEY): price every paper fill
 * and an hourly probe per market on Jupiter, without signing anything.
 */
async function shadow(): Promise<void> {
  const config = jupiterConfig();
  if (!config) return;
  const plan = await withState((state) => ({
    jobs: planShadowJobs(state, Date.now()),
    decimals: { ...(state.shadow ?? emptyShadow()).decimals },
  }));
  if (plan.jobs.length === 0) return;
  const outcome = await runShadowJobs(plan.jobs, config, plan.decimals);
  await withState(async (state) => {
    applyShadowOutcome(state, outcome, Date.now());
    await saveState(state);
  });
}

/** Send pending alert lines to Telegram. On failure they stay pending for the next tick. */
async function notify(): Promise<void> {
  const config = telegramConfig();
  if (!config) return;
  const batch = await withState((state) => {
    const lines = pendingAlerts(state);
    if (lines.length === 0) return null;
    return { text: formatAlerts(lines, state), seq: Math.max(...lines.map(logSeq)) };
  });
  if (!batch) return;
  try {
    await sendTelegram(config, batch.text);
    await withState(async (state) => {
      state.notifiedSeq = Math.max(state.notifiedSeq ?? 0, batch.seq);
      await saveState(state);
    });
  } catch (error) {
    console.error("telegram", message(error));
  }
}

/**
 * One pass over every market. Network calls happen outside the state lock;
 * results are applied inside it, so the dashboard never waits on Binance.
 */
export async function tick(): Promise<void> {
  if (g.__botTicking) return;
  g.__botTicking = true;
  try {
    const plan = await withState((state) => {
      const now = Date.now();
      return state.books.map((book) => ({
        id: book.id,
        interval: state.settings.interval,
        settings: state.settings,
        validate: validationDue(state, book, now),
        poll: !book.polledAt || now - book.polledAt >= POLL_MS,
      }));
    });

    for (const item of plan) {
      const market = marketById(item.id);
      if (!market) continue;
      if (item.validate) {
        try {
          const { candles } = await fetchCandles(market, item.interval, VALIDATION_BARS[item.interval]);
          const validation = validateMarket(item.settings, candles, Date.now());
          await withState((state) => {
            const book = state.books.find((b) => b.id === item.id);
            if (book && state.settings.interval === item.interval) applyValidation(state, book, validation, Date.now());
          });
        } catch (error) {
          await withState((state) => {
            const book = state.books.find((b) => b.id === item.id);
            if (book) setBookError(state, book, `Validación: ${message(error)}`);
          });
        }
      }
      if (item.poll) {
        try {
          const { candles } = await fetchCandles(market, item.interval, LIVE_BARS);
          candleCache().set(`${item.id}:${item.interval}`, candles);
          await withState((state) => {
            const book = state.books.find((b) => b.id === item.id);
            if (book && state.settings.interval === item.interval) onCandles(state, book, candles, Date.now());
          });
        } catch (error) {
          await withState((state) => {
            const book = state.books.find((b) => b.id === item.id);
            if (book) {
              setBookError(state, book, message(error));
              book.polledAt = Date.now();
            }
          });
        }
      }
    }

    const sol = await withState((state) => state.books.find((b) => b.id === "SOL")?.lastPrice ?? null);
    const solPrice = sol ?? (await solPriceNow());
    await withState(async (state) => {
      if (solPrice) state.solPrice = solPrice;
      markAccount(state, Date.now());
      await saveState(state);
    });
    await shadow();
    await notify();
    kickMeteoraForward();
  } finally {
    g.__botTicking = false;
  }
}

/** The bot trades from the server process, with or without a browser open. */
export function startLoop(): void {
  if (g.__botLoop) return;
  console.log("Bot de estrategia en papel: ciclo cada 15 s.");
  void tick().catch((error: unknown) => console.error("tick", error));
  g.__botLoop = setInterval(() => {
    void tick().catch((error: unknown) => console.error("tick", error));
  }, 15_000);
}

export function readBot(): Promise<BotView> {
  startLoop();
  return withState((state) => toView(state, candleCache()));
}

export type ActionBody = {
  type?: string;
  active?: boolean;
  id?: string;
  settings?: Partial<BotSettings>;
};

export function runAction(body: ActionBody): Promise<{ ok: true; view: BotView } | { ok: false; error: string; view: BotView }> {
  return withState(async (state) => {
    const now = Date.now();
    let error: string | null = null;
    if (body.type === "halt") setHalt(state, Boolean(body.active), now);
    else if (body.type === "close") error = closeMarket(state, body.id ?? "", now);
    else if (body.type === "settings") applySettings(state, clampBotSettings({ ...state.settings, ...body.settings }), now);
    else if (body.type === "profile") {
      const profile = PROFILES[body.id as ProfileId];
      if (!profile) error = "Perfil desconocido.";
      else applySettings(state, clampBotSettings({ ...state.settings, ...profile.values }), now);
    }
    else if (body.type === "revalidate") for (const book of state.books) book.validation = null;
    else if (body.type === "telegram-test") {
      const config = telegramConfig();
      if (!config) error = "Telegram no está configurado: falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID.";
      else {
        try {
          await sendTelegram(config, "<b>🤖 Bot Solana</b>\n✅ Alertas funcionando. Te avisaré de compras, ventas, cortes de riesgo y un resumen diario.");
        } catch (e) {
          error = message(e);
        }
      }
    }
    else if (body.type === "reset") {
      const fresh = createBotState(now, state.settings, state.solPrice);
      g.__botState = fresh;
      await saveState(fresh);
      return { ok: true as const, view: toView(fresh, candleCache()) };
    } else error = "Acción desconocida.";
    markAccount(state, now);
    await saveState(state);
    const view = toView(state, candleCache());
    return error ? { ok: false as const, error, view } : { ok: true as const, view };
  });
}
