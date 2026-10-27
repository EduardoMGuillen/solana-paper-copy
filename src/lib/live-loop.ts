import { kickLiveLp } from "./exec/lp-runner";
import { kickTelegramCommands } from "./exec/telegram-control";

const TICK_MS = 15_000;

const g = globalThis as unknown as { __liveLoop?: ReturnType<typeof setInterval> };

function tick(): void {
  kickLiveLp();
  kickTelegramCommands();
}

/** Meteora live runs from the server process, with or without a window open. Each kick guards its own reentry. */
export function startLiveLoop(): void {
  if (g.__liveLoop) return;
  console.log("PolloTraderBot: ciclo de Meteora live cada 15 s.");
  tick();
  g.__liveLoop = setInterval(tick, TICK_MS);
}
