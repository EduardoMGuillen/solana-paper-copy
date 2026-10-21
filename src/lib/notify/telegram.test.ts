import { afterEach, describe, expect, it, vi } from "vitest";
import { addLog, createBotState, markAccount } from "../bot/engine";
import { defaultBotSettings } from "../bot/settings";
import { formatAlerts, formatBalance, formatLiveDigest, formatLiveNotice, formatLiveSell, liveDigestDue, LIVE_DIGEST_MS, parseLiveCommand, pendingAlerts, pickCloseTarget, readTelegramUpdates, sendTelegram, telegramConfig } from "./telegram";

function state() {
  const s = createBotState(0, { ...defaultBotSettings, markets: ["SOL"] }, 100);
  s.notifiedSeq = s.seq;
  return s;
}

describe("telegram alerts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is off unless both token and chat id are set", () => {
    expect(telegramConfig({})).toBeNull();
    expect(telegramConfig({ TELEGRAM_BOT_TOKEN: "t" })).toBeNull();
    expect(telegramConfig({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1" })).toEqual({ token: "t", chatId: "1" });
  });

  it("sends buys, sells and warnings, not routine info lines, and nothing twice", () => {
    const s = state();
    addLog(s, 1, "SOL", "Compra a 100", "buy");
    addLog(s, 2, null, "Ajustes de riesgo guardados.");
    addLog(s, 3, null, "Drawdown alto", "warn");
    expect(pendingAlerts(s).map((l) => l.text)).toEqual(["Compra a 100", "Drawdown alto"]);
    s.notifiedSeq = s.seq;
    expect(pendingAlerts(s)).toHaveLength(0);
  });

  it("adds a daily summary when the UTC day rolls over", () => {
    const s = state();
    markAccount(s, 2 * 86_400_000);
    expect(pendingAlerts(s).some((l) => l.text.startsWith("Resumen"))).toBe(true);
  });

  it("describes a live open and a live close without putting the bot token in the text", () => {
    const open = formatLiveNotice({ kind: "open", name: "WEFT <SOL>", stakeSol: 0.0141, signature: "sig123" });
    expect(open).toContain("Abierta");
    expect(open).toContain("WEFT &lt;SOL&gt;");
    expect(open).toContain("0.0141 SOL");
    expect(open).toContain("https://solscan.io/tx/sig123");
    const closed = formatLiveNotice({ kind: "close", name: "pill-SOL", stakeSol: 0.02, signature: null, reason: "manual" });
    expect(closed).toContain("Cerrada");
    expect(closed).toContain("manual");
    expect(closed).not.toContain("solscan");
    const sold = formatLiveSell({ name: "pill <SOL>", outSol: 0.012, signature: "sigsell", note: null });
    expect(sold).toContain("Vendido");
    expect(sold).toContain("pill &lt;SOL&gt;");
    expect(sold).toContain("0.0120 SOL");
    expect(sold).toContain("https://solscan.io/tx/sigsell");
    const kept = formatLiveSell({ name: "pill-SOL", outSol: null, signature: null, note: "La venta pasaría el tope de impacto." });
    expect(kept).toContain("impacto");
    expect(kept).not.toContain("solscan");
  });

  it("lists open live positions every 15 minutes and stays quiet about the paper book", () => {
    expect(LIVE_DIGEST_MS).toBe(15 * 60 * 1000);
    expect(liveDigestDue(null, 1_000)).toBe(true);
    expect(liveDigestDue(1_000, 1_000 + LIVE_DIGEST_MS - 1)).toBe(false);
    expect(liveDigestDue(1_000, 1_000 + LIVE_DIGEST_MS)).toBe(true);
    const empty = formatLiveDigest({ now: 1_000, positions: [], notice: "Ningún pool cabe. No se envió nada." });
    expect(empty).toContain("0 abiertas");
    expect(empty).toContain("Ningún pool cabe");
    expect(empty).not.toContain("papel");
    const now = 3_600_000;
    const text = formatLiveDigest({
      now,
      notice: null,
      positions: [
        { name: "WEFT <SOL>", stakeSol: 0.0141, openedAt: now - 3_600_000, closing: false, closeReason: null, positionPct: 0.012, tokenPct: -0.03 },
        { name: "pill-SOL", stakeSol: 0.02, openedAt: now - 120_000, closing: true, closeReason: "manual", positionPct: null, tokenPct: null },
      ],
    });
    expect(text).toContain("1 abierta");
    expect(text).toContain("0.0141 SOL");
    expect(text).toContain("WEFT &lt;SOL&gt;");
    expect(text).toContain("posición +1.2%");
    expect(text).toContain("precio -3.0%");
    expect(text).toContain("1 h");
    expect(text).toContain("cerrando (manual)");
    expect(text).toContain("1 cerrando");
  });

  it("escapes HTML from log text and stays under Telegram's size limit", () => {
    const s = state();
    addLog(s, 1, "SOL", "precio <script> & co", "warn");
    for (let i = 0; i < 200; i += 1) addLog(s, i, "SOL", "x".repeat(100), "sell");
    const text = formatAlerts(pendingAlerts(s), s);
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).not.toContain("<script>");
    expect(formatAlerts(pendingAlerts(state()), state())).toContain("Bot Solana");
  });

  it("parses owner commands and refuses to turn the bot on", () => {
    expect(parseLiveCommand("  Saldo ")).toEqual({ kind: "balance" });
    expect(parseLiveCommand("/estado@TradingMcPolloBot")).toEqual({ kind: "status" });
    expect(parseLiveCommand("cerrar todo")).toEqual({ kind: "stop" });
    expect(parseLiveCommand("cerrar pill")).toEqual({ kind: "close", query: "pill" });
    expect(parseLiveCommand("hola")).toBeNull();
    expect(parseLiveCommand("abrir")).toEqual({ kind: "refused" });
    expect(parseLiveCommand("/start")).toEqual({ kind: "help" });
  });

  it("picks one live position to close and asks when several match", () => {
    const rows = [
      { address: "a", name: "pill-SOL", closing: false },
      { address: "b", name: "WEFT <SOL>", closing: false },
    ];
    expect(pickCloseTarget(rows, null)).toEqual({ reply: expect.stringContaining("Hay 2") });
    expect(pickCloseTarget(rows, "pill")).toEqual({ address: "a", name: "pill-SOL" });
    expect(pickCloseTarget([{ address: "b", name: "WEFT <SOL>", closing: false }], "weft")).toEqual({ address: "b", name: "WEFT <SOL>" });
    const none = pickCloseTarget([], null);
    expect("reply" in none ? none.reply : "").toContain("No hay posiciones");
    expect(formatBalance({ balanceSol: 0.3777, balanceUsd: 40.03, running: true, openCount: 0 })).toContain("0.3777 SOL");
    expect(formatBalance({ balanceSol: 0.3777, balanceUsd: 40.03, running: true, openCount: 0 })).toContain("40.03 US$");
  });

  it("reads updates without putting the bot token in an error", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      result: [{ update_id: 7, message: { chat: { id: 42 }, text: "saldo" } }, { update_id: 8, message: { chat: { id: 9 } } }],
    }), { status: 200 }));
    const updates = await readTelegramUpdates({ token: "SECRET", chatId: "42" }, 3);
    expect(updates).toEqual([{ updateId: 7, chatId: "42", text: "saldo" }, { updateId: 8, chatId: "9", text: "" }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("getUpdates");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.offset).toBe(3);
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 401 }));
    await expect(readTelegramUpdates({ token: "SECRET", chatId: "42" }, null)).rejects.toThrow(/401/);
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 401 }));
    await expect(readTelegramUpdates({ token: "SECRET", chatId: "42" }, null)).rejects.not.toThrow(/SECRET/);
  });

  it("posts HTML to the Bot API and never leaks the token in errors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await sendTelegram({ token: "SECRET", chatId: "42" }, "hola");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.telegram.org/botSECRET/sendMessage");
    expect(JSON.parse(String(init?.body))).toMatchObject({ chat_id: "42", text: "hola", parse_mode: "HTML" });

    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
    await expect(sendTelegram({ token: "SECRET", chatId: "42" }, "hola")).rejects.toThrow(/401/);
    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
    await expect(sendTelegram({ token: "SECRET", chatId: "42" }, "hola")).rejects.not.toThrow(/SECRET/);
  });
});
