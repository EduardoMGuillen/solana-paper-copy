import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pollTelegramCommands } from "./telegram-control";
import { createDedicatedWallet, readLiveFile, setLiveBot } from "./wallet";

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-cmd-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function updates(rows: { id: number; chat: string; text: string }[]) {
  return new Response(JSON.stringify({
    ok: true,
    result: rows.map((row) => ({ update_id: row.id, message: { chat: { id: Number(row.chat) }, text: row.text } })),
  }), { status: 200 });
}

describe("telegram commands", () => {
  it("stops the live bot from the owner chat and ignores everyone else", async () => {
    const dir = tempDir();
    createDedicatedWallet(dir);
    setLiveBot(dir, true);
    const env = { WALLET_DIR: dir, TELEGRAM_BOT_TOKEN: "SECRET", TELEGRAM_CHAT_ID: "42" };
    const sent: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const target = String(url);
      if (target.includes("getUpdates")) return updates([{ id: 4, chat: "999", text: "stop" }]);
      if (target.includes("sendMessage")) {
        sent.push(JSON.parse(String(init?.body)).text as string);
        return new Response("{}", { status: 200 });
      }
      throw new Error("unexpected fetch");
    });

    await pollTelegramCommands(env, 1_000, () => undefined);
    expect(readLiveFile(dir).running).toBe(true);
    expect(sent).toEqual([]);
    expect(fs.readFileSync(path.join(dir, "telegram.offset"), "utf8")).toBe("5");

    fetchMock.mockImplementation(async (url, init) => {
      const target = String(url);
      if (target.includes("getUpdates")) return updates([{ id: 5, chat: "42", text: "stop" }]);
      if (target.includes("sendMessage")) {
        sent.push(JSON.parse(String(init?.body)).text as string);
        return new Response("{}", { status: 200 });
      }
      throw new Error("unexpected fetch");
    });
    let kicks = 0;
    await pollTelegramCommands(env, 2_000, () => {
      kicks += 1;
    });
    expect(readLiveFile(dir).running).toBe(false);
    expect(kicks).toBe(1);
    expect(sent[0]).toContain("Stop");
    expect(sent[0]).not.toContain("SECRET");
    expect(fs.readFileSync(path.join(dir, "telegram.offset"), "utf8")).toBe("6");
  });

  it("closes the only open position and does not turn the bot on", async () => {
    const dir = tempDir();
    createDedicatedWallet(dir);
    setLiveBot(dir, true);
    const pool = "EQEu6NyEq8nECAiem1YkTu3uDBiGTEA2tYBLBmr9YJ7Y";
    const current = readLiveFile(dir);
    fs.writeFileSync(path.join(dir, "bot.json"), JSON.stringify({
      ...current,
      positions: [{ address: pool, name: "pill-SOL", stakeSol: 0.02, openedAt: 1, signature: "sig", closing: false }],
    }));
    const env = { WALLET_DIR: dir, TELEGRAM_BOT_TOKEN: "SECRET", TELEGRAM_CHAT_ID: "42" };
    const sent: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const target = String(url);
      if (target.includes("getUpdates")) return updates([{ id: 1, chat: "42", text: "close" }, { id: 2, chat: "42", text: "abrir" }]);
      if (target.includes("sendMessage")) {
        sent.push(JSON.parse(String(init?.body)).text as string);
        return new Response("{}", { status: 200 });
      }
      throw new Error("unexpected fetch");
    });
    await pollTelegramCommands(env, 1_000, () => undefined);
    expect(readLiveFile(dir).running).toBe(true);
    expect(readLiveFile(dir).positions[0]?.closing).toBe(true);
    expect(readLiveFile(dir).positions[0]?.closeReason).toBe("manual");
    expect(sent[0]).toContain("Closing");
    expect(sent[1]).toContain("cannot be started");
  });
});
