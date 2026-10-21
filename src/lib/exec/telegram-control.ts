/**
 * Reads the owner's Telegram chat and applies only risk-reducing commands:
 * balance, status, close one position, stop. Start stays on the web page.
 * Messages from any other chat are ignored.
 */

import fs from "node:fs";
import path from "node:path";
import { fetchSolUsd } from "../bot/market";
import {
  formatBalance,
  formatLiveDigest,
  LIVE_COMMAND_HELP,
  parseLiveCommand,
  pickCloseTarget,
  readTelegramUpdates,
  sendTelegram,
  telegramConfig,
  type LiveCommand,
} from "../notify/telegram";
import { kickLiveLp } from "./lp-runner";
import { closeLivePosition, readLiveFile, setLiveBot, walletDir, walletStatus, withSolUsd, withWallet } from "./wallet";

function offsetFile(dir: string): string {
  return path.join(dir, "telegram.offset");
}

function readOffset(dir: string): number | null {
  try {
    const value = Number(fs.readFileSync(offsetFile(dir), "utf8"));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeOffset(dir: string, offset: number): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(offsetFile(dir), String(offset), "utf8");
}

async function replyFor(dir: string, command: LiveCommand, env: Record<string, string | undefined>, now: number, kick: () => void): Promise<string> {
  if (command.kind === "help") return LIVE_COMMAND_HELP;
  if (command.kind === "refused") return "<b>Meteora live</b> · Desde Telegram no se enciende. Start queda en la página.";
  if (command.kind === "status") {
    const file = readLiveFile(dir);
    return formatLiveDigest({ now, positions: file.positions, notice: file.running ? file.notice : "Apagado. No abre posiciones." });
  }
  if (command.kind === "balance") {
    const [status, solUsd] = await Promise.all([walletStatus(env), fetchSolUsd()]);
    const view = withSolUsd(status, solUsd);
    return formatBalance({
      balanceSol: view.balanceSol,
      balanceUsd: view.balanceUsd,
      running: view.running,
      openCount: view.positions.filter((position) => !position.closing).length,
    });
  }
  if (command.kind === "stop") {
    await withWallet(() => setLiveBot(dir, false));
    kick();
    const left = readLiveFile(dir).positions.length;
    return left === 0
      ? "<b>Meteora live</b> · Stop. No había posiciones. Ya no abre."
      : `<b>Meteora live</b> · Stop. Cerrando ${left}.`;
  }
  const picked = pickCloseTarget(readLiveFile(dir).positions, command.query);
  if ("reply" in picked) return picked.reply;
  const closed = await withWallet(() => closeLivePosition(dir, picked.address));
  if (closed.error) return `<b>Meteora live</b> · ${closed.error}`;
  kick();
  return `<b>Meteora live</b> · Cerrando <b>${picked.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</b>.`;
}

/** One short poll. A failure here never reaches the paper loop. */
export async function pollTelegramCommands(
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
  kick: () => void = kickLiveLp,
): Promise<void> {
  const config = telegramConfig(env);
  if (!config) return;
  const dir = walletDir(env);
  let updates;
  try {
    updates = await readTelegramUpdates(config, readOffset(dir));
  } catch (error) {
    console.error("telegram comandos", error instanceof Error ? error.message : "sin respuesta");
    return;
  }
  if (updates.length === 0) return;
  let failed = false;
  for (const update of updates) {
    if (update.chatId !== config.chatId || !update.text) continue;
    const command = parseLiveCommand(update.text);
    if (!command) continue;
    try {
      const text = await replyFor(dir, command, env, now, kick);
      await sendTelegram(config, text);
    } catch (error) {
      failed = true;
      console.error("telegram comandos", error instanceof Error ? error.message : "falló");
    }
  }
  if (!failed) writeOffset(dir, Math.max(...updates.map((update) => update.updateId)) + 1);
}

let pending: Promise<void> | null = null;

export function kickTelegramCommands(): void {
  if (pending) return;
  pending = pollTelegramCommands()
    .catch((error: unknown) => {
      console.error("telegram comandos", error instanceof Error ? error.message : "falló");
    })
    .finally(() => {
      pending = null;
    });
}
