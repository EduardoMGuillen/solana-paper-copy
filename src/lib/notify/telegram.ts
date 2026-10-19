import { accountEquity, type BotState, type LogLine } from "../bot/engine";

/**
 * Telegram push alerts. Configure with TELEGRAM_BOT_TOKEN (from @BotFather)
 * and TELEGRAM_CHAT_ID. Without both, alerts are silently off.
 *
 * Alerts come from the bot's own log: every line flagged `alert` since the
 * last successful send goes out as one batched message per tick.
 */

const MAX_LEN = 4_000; // Telegram's hard limit is 4096
const MAX_LINES = 25;

export type TelegramConfig = { token: string; chatId: string };

export function telegramConfig(env: Record<string, string | undefined> = process.env): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  return token && chatId ? { token, chatId } : null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function logSeq(line: LogLine): number {
  const n = Number(line.id.split("-").pop());
  return Number.isFinite(n) ? n : 0;
}

const ICON: Record<LogLine["tone"], string> = { buy: "🟢", sell: "🔴", warn: "⚠️", info: "ℹ️" };

/** Pending alert lines, oldest first, capped so a long outage cannot flood the chat. */
export function pendingAlerts(state: BotState): LogLine[] {
  const after = state.notifiedSeq ?? 0;
  return state.log.filter((line) => line.alert && logSeq(line) > after).slice(-MAX_LINES);
}

export function formatAlerts(lines: LogLine[], state: BotState): string {
  const body = lines.map((line) => {
    const time = new Date(line.t).toISOString().slice(11, 16);
    const market = line.market ? `<b>${escapeHtml(line.market)}</b> · ` : "";
    return `${ICON[line.tone]} ${time} UTC · ${market}${escapeHtml(line.text)}`;
  });
  const equity = accountEquity(state);
  const sol = state.solPrice > 0 ? ` · ${(equity / state.solPrice).toFixed(4)} SOL` : "";
  const header = "<b>🤖 Bot Solana</b>";
  const footer = `<i>Patrimonio ≈ ${equity.toFixed(2)} US$${sol} · papel</i>`;
  // Keep whole lines only: cutting mid-line could split an HTML tag and Telegram would reject the message.
  const kept: string[] = [];
  let length = header.length + footer.length + 40;
  for (const line of body.reverse()) {
    if (length + line.length + 1 > MAX_LEN) break;
    kept.unshift(line);
    length += line.length + 1;
  }
  const skipped = body.length - kept.length;
  return [header, ...(skipped > 0 ? [`…${skipped} alertas anteriores omitidas`] : []), ...kept, footer].join("\n");
}

export async function sendTelegram(config: TelegramConfig, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: config.chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // Never echo the URL: it contains the bot token.
    const detail = await response.text().catch(() => "");
    throw new Error(`Telegram respondió ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
}
