import { afterEach, describe, expect, it, vi } from "vitest";
import { addLog, createBotState, markAccount } from "../bot/engine";
import { defaultBotSettings } from "../bot/settings";
import { formatAlerts, pendingAlerts, sendTelegram, telegramConfig } from "./telegram";

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

  it("escapes HTML from log text and stays under Telegram's size limit", () => {
    const s = state();
    addLog(s, 1, "SOL", "precio <script> & co", "warn");
    for (let i = 0; i < 200; i += 1) addLog(s, i, "SOL", "x".repeat(100), "sell");
    const text = formatAlerts(pendingAlerts(s), s);
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).not.toContain("<script>");
    expect(formatAlerts(pendingAlerts(state()), state())).toContain("Bot Solana");
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
