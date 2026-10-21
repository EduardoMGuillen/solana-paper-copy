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

/** One Meteora live fill. The chat is TELEGRAM_CHAT_ID, never a phone number. */
export function formatLiveNotice(event: {
  kind: "open" | "close";
  name: string;
  stakeSol: number;
  signature: string | null;
  reason?: string | null;
}): string {
  const icon = event.kind === "open" ? "🟢" : "🔴";
  const verb = event.kind === "open" ? "Abierta" : "Cerrada";
  const why = event.kind === "close" && event.reason ? ` · ${escapeHtml(event.reason)}` : "";
  const link = event.signature && event.signature !== "already-closed"
    ? `\n<a href="https://solscan.io/tx/${encodeURIComponent(event.signature)}">Ver en Solscan</a>`
    : "";
  return `${icon} <b>Meteora live</b> · ${verb} <b>${escapeHtml(event.name)}</b> · ${event.stakeSol.toFixed(4)} SOL${why}${link}`;
}

/** Result of selling the token left by a live close. `outSol` null means the token stayed. */
export function formatLiveSell(event: { name: string; outSol: number | null; signature: string | null; note: string | null }): string {
  if (event.outSol != null && event.signature) {
    return `🟡 <b>Meteora live</b> · Vendido <b>${escapeHtml(event.name)}</b> · ${event.outSol.toFixed(4)} SOL\n<a href="https://solscan.io/tx/${encodeURIComponent(event.signature)}">Ver en Solscan</a>`;
  }
  return `⚠️ <b>Meteora live</b> · Cerrada <b>${escapeHtml(event.name)}</b> · ${escapeHtml(event.note ?? "El token se quedó en la wallet.")}`;
}

/** How often the open-position snapshot is pushed. Open and close stay immediate. */
export const LIVE_DIGEST_MS = 15 * 60 * 1000;

export function liveDigestDue(lastAt: number | null, now: number, everyMs = LIVE_DIGEST_MS): boolean {
  return lastAt == null || now - lastAt >= everyMs;
}

export type LiveDigestRow = {
  name: string;
  stakeSol: number;
  openedAt: number;
  closing: boolean;
  closeReason: string | null;
  positionPct: number | null;
  tokenPct: number | null;
};

function signedPct(fraction: number): string {
  const value = fraction * 100;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function ageLabel(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/** Snapshot of Meteora live positions only. No paper book, no wallet secret. */
export function formatLiveDigest(input: { now: number; positions: LiveDigestRow[]; notice: string | null }): string {
  const open = input.positions.filter((position) => !position.closing);
  const closing = input.positions.length - open.length;
  const stake = open.reduce((sum, position) => sum + position.stakeSol, 0);
  const count = `${open.length} abierta${open.length === 1 ? "" : "s"}`;
  const header = `📊 <b>Meteora live</b> · ${count}${open.length > 0 ? ` · ${stake.toFixed(4)} SOL` : ""}${closing > 0 ? ` · ${closing} cerrando` : ""}`;
  if (input.positions.length === 0) {
    const why = input.notice ? `\n${escapeHtml(input.notice)}` : "";
    return `${header}${why}`;
  }
  const lines = input.positions.map((position) => {
    const pnl = position.positionPct == null ? "" : ` · posición ${signedPct(position.positionPct)}`;
    const price = position.tokenPct == null ? "" : ` · precio ${signedPct(position.tokenPct)}`;
    const state = position.closing ? ` · cerrando${position.closeReason ? ` (${escapeHtml(position.closeReason)})` : ""}` : `${pnl}${price}`;
    return `• <b>${escapeHtml(position.name)}</b> · ${position.stakeSol.toFixed(4)} SOL${state} · ${ageLabel(input.now - position.openedAt)}`;
  });
  return [header, ...lines].join("\n").slice(0, MAX_LEN);
}

export type LiveCommand =
  | { kind: "balance" }
  | { kind: "status" }
  | { kind: "stop" }
  | { kind: "close"; query: string | null }
  | { kind: "help" }
  | { kind: "refused" };

export const LIVE_COMMAND_HELP = [
  "<b>Meteora live</b>",
  "saldo — SOL y dólares",
  "estado — posiciones abiertas",
  "cerrar — cierra la única abierta",
  "cerrar nombre — cierra esa",
  "stop — cierra todas y deja de abrir",
].join("\n");

/** Commands the owner can send. Anything else is ignored. Start is not one of them. */
export function parseLiveCommand(raw: string): LiveCommand | null {
  const text = raw.trim().toLowerCase().replace(/^\//, "").replace(/@\w+/, "").trim();
  if (!text) return null;
  if (["saldo", "balance", "update", "usd"].includes(text)) return { kind: "balance" };
  if (["estado", "posiciones", "posicion", "status"].includes(text)) return { kind: "status" };
  if (["stop", "parar", "detener", "cerrar todo", "cerrar todas", "close all"].includes(text)) return { kind: "stop" };
  if (["ayuda", "help", "comandos", "start"].includes(text)) return { kind: "help" };
  if (["abrir", "enciende", "encender", "arranca"].includes(text)) return { kind: "refused" };
  if (text === "cerrar" || text === "close") return { kind: "close", query: null };
  const named = text.startsWith("cerrar ") ? text.slice("cerrar ".length) : text.startsWith("close ") ? text.slice("close ".length) : null;
  if (named != null) return { kind: "close", query: named.trim() || null };
  return null;
}

export function formatBalance(input: { balanceSol: number | null; balanceUsd: number | null; running: boolean; openCount: number }): string {
  const sol = input.balanceSol != null ? `${input.balanceSol.toFixed(4)} SOL` : "saldo no disponible";
  const usd = input.balanceUsd != null ? ` · ${input.balanceUsd.toFixed(2)} US$` : "";
  const state = input.running ? "Encendido" : "Apagado";
  const n = input.openCount;
  return `<b>Meteora live</b> · ${sol}${usd}\n${state} · ${n} abierta${n === 1 ? "" : "s"}`;
}

export function pickCloseTarget(
  positions: { address: string; name: string; closing: boolean }[],
  query: string | null,
): { address: string; name: string } | { reply: string } {
  const open = positions.filter((position) => !position.closing);
  if (positions.length === 0) return { reply: "<b>Meteora live</b> · No hay posiciones abiertas." };
  if (query == null) {
    if (open.length === 1) return { address: open[0].address, name: open[0].name };
    if (open.length === 0) return { reply: `<b>Meteora live</b> · ${positions.map((position) => escapeHtml(position.name)).join(", ")} ya se están cerrando.` };
    return { reply: `<b>Meteora live</b> · Hay ${open.length}. Escribe cerrar y el nombre:\n${open.map((position) => `• ${escapeHtml(position.name)}`).join("\n")}` };
  }
  const needle = query.toLowerCase();
  const hits = open.filter((position) => position.name.toLowerCase().includes(needle));
  if (hits.length === 1) return { address: hits[0].address, name: hits[0].name };
  if (hits.length === 0) {
    const closing = positions.find((position) => position.closing && position.name.toLowerCase().includes(needle));
    if (closing) return { reply: `<b>Meteora live</b> · ${escapeHtml(closing.name)} ya se está cerrando.` };
    return { reply: "<b>Meteora live</b> · No hay una posición con ese nombre." };
  }
  return { reply: `<b>Meteora live</b> · Hay varias. Escribe más del nombre:\n${hits.map((position) => `• ${escapeHtml(position.name)}`).join("\n")}` };
}

export type IncomingTelegram = { updateId: number; chatId: string; text: string };

/** Short poll. The URL holds the token and must never appear in an error. */
export async function readTelegramUpdates(config: TelegramConfig, offset: number | null): Promise<IncomingTelegram[]> {
  const response = await fetch(`https://api.telegram.org/bot${config.token}/getUpdates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ timeout: 0, allowed_updates: ["message"], ...(offset != null ? { offset } : {}) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Telegram respondió ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const body = (await response.json()) as { ok?: boolean; result?: unknown };
  if (!body.ok || !Array.isArray(body.result)) return [];
  const incoming: IncomingTelegram[] = [];
  for (const row of body.result) {
    if (!row || typeof row !== "object") continue;
    const update = row as { update_id?: unknown; message?: { chat?: { id?: unknown }; text?: unknown } };
    if (typeof update.update_id !== "number") continue;
    const chatId = update.message?.chat?.id;
    const text = update.message?.text;
    incoming.push({
      updateId: update.update_id,
      chatId: typeof chatId === "number" || typeof chatId === "string" ? String(chatId) : "",
      text: typeof text === "string" ? text : "",
    });
  }
  return incoming;
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
