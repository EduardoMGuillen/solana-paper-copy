import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readIntents } from "./intents";
import type { LiveCandidate } from "./lp-plan";
import { runLiveCycle, sendLiveDigest } from "./lp-runner";
import type { LiveChain } from "./lp-chain";
import { closeLivePosition, createDedicatedWallet, readLiveFile, setLiveBot } from "./wallet";

const pool = "EQEu6NyEq8nECAiem1YkTu3uDBiGTEA2tYBLBmr9YJ7Y";
const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-lp-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function candidate(): LiveCandidate {
  return {
    t: 1,
    address: pool,
    name: "WEFT-SOL",
    price: 0.001,
    tvl: 20_000,
    binStep: 250,
    baseFeePct: 2,
    fees1h: 100,
    fees24h: 2_000,
    volume1h: 20_000,
    volume24h: 40_000,
    solIsY: true,
    tokenMint: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  };
}

function chain(balance: number, calls: string[]): LiveChain {
  return {
    balanceLamports: async () => balance,
    landed: async () => false,
    open: async (_order, onSent) => {
      calls.push("open");
      const sent = { signature: "sigopen", position: "Pos111111111111111111111111111111111111111", minBinId: 100, maxBinId: 156 };
      onSent(sent);
      return sent;
    },
    close: async (_position, onSent) => {
      calls.push("close");
      onSent("sigclose");
      return "sigclose";
    },
    sell: async () => {
      calls.push("sell");
      return { sold: false, reason: "none" };
    },
  };
}

describe("live cycle", () => {
  it("opens one real record and does not open it again", async () => {
    const dir = tempDir();
    createDedicatedWallet(dir);
    setLiveBot(dir, true);
    const calls: string[] = [];
    const env = { LIVE_MIN_SOL_RESERVE: "0.03", LIVE_LP_MAX_SOL: "0.3" };
    await runLiveCycle(dir, chain(2_000_000_000, calls), async () => [candidate()], env, 10_000);
    expect(calls).toEqual(["open"]);
    const book = readLiveFile(dir);
    expect(book.positions).toHaveLength(1);
    expect(book.positions[0]?.signature).toBe("sigopen");
    expect(book.positions[0]?.stakeSol).toBeCloseTo(0.2);
    await runLiveCycle(dir, chain(2_000_000_000, calls), async () => [candidate()], env, 20_000);
    expect(calls).toEqual(["open"]);
    const secret = fs.readFileSync(path.join(dir, "wallet.json"), "utf8").slice(0, 24);
    expect(fs.readFileSync(path.join(dir, "intents.jsonl"), "utf8")).not.toContain(secret);
    expect(readIntents(dir).some((intent) => intent.status === "sent" && intent.signature === "sigopen")).toBe(true);
  });

  it("does not send when the wallet cannot cover the reserve", async () => {
    const dir = tempDir();
    createDedicatedWallet(dir);
    setLiveBot(dir, true);
    const calls: string[] = [];
    await runLiveCycle(dir, chain(50_000_000, calls), async () => [candidate()], { LIVE_MIN_SOL_RESERVE: "0.03", LIVE_LP_MAX_SOL: "0.3" }, 10_000);
    expect(calls).toEqual([]);
    expect(readLiveFile(dir).positions).toHaveLength(0);
    expect(readLiveFile(dir).notice).toMatch(/reserva|No se envió/);
  });

  it("stop closes the open position on the next pass", async () => {
    const dir = tempDir();
    createDedicatedWallet(dir);
    setLiveBot(dir, true);
    const calls: string[] = [];
    const env = { LIVE_MIN_SOL_RESERVE: "0.03", LIVE_LP_MAX_SOL: "0.3" };
    const used = chain(2_000_000_000, calls);
    await runLiveCycle(dir, used, async () => [candidate()], env, 10_000);
    setLiveBot(dir, false);
    await runLiveCycle(dir, used, async () => [candidate()], env, 20_000);
    expect(calls).toEqual(["open", "close", "sell"]);
    expect(readLiveFile(dir).running).toBe(false);
    expect(readLiveFile(dir).positions).toHaveLength(0);
  });

  it("opens the same pool again after a manual close once it still qualifies", async () => {
    const dir = tempDir();
    createDedicatedWallet(dir);
    setLiveBot(dir, true);
    const calls: string[] = [];
    const env = { LIVE_MIN_SOL_RESERVE: "0.03", LIVE_LP_MAX_SOL: "0.3" };
    const used = chain(2_000_000_000, calls);
    await runLiveCycle(dir, used, async () => [candidate()], env, 10_000);
    expect(closeLivePosition(dir, pool).error).toBeNull();
    await runLiveCycle(dir, used, async () => [candidate()], env, 20_000);
    await runLiveCycle(dir, used, async () => [candidate()], env, 30_000);
    expect(calls).toEqual(["open", "close", "sell", "open"]);
    expect(readLiveFile(dir).running).toBe(true);
    expect(readLiveFile(dir).positions).toHaveLength(1);
  });

  it("keeps the position closed when the token sale fails and records the sale when it lands", async () => {
    const dir = tempDir();
    createDedicatedWallet(dir);
    setLiveBot(dir, true);
    const calls: string[] = [];
    const env = { LIVE_MIN_SOL_RESERVE: "0.03", LIVE_LP_MAX_SOL: "0.3" };
    const used = chain(2_000_000_000, calls);
    used.sell = async () => {
      calls.push("sell");
      throw new Error("La simulación rechazó la venta.");
    };
    await runLiveCycle(dir, used, async () => [candidate()], env, 10_000);
    setLiveBot(dir, false);
    await runLiveCycle(dir, used, async () => [candidate()], env, 20_000);
    expect(readLiveFile(dir).positions).toHaveLength(0);
    expect(readLiveFile(dir).notice).toMatch(/se quedó/);
    expect(readIntents(dir).some((intent) => intent.kind === "sell" && intent.status === "failed")).toBe(true);

    const again = tempDir();
    createDedicatedWallet(again);
    setLiveBot(again, true);
    const sold: string[] = [];
    const seller = chain(2_000_000_000, sold);
    seller.sell = async (_position, onSent) => {
      sold.push("sell");
      onSent("sigsell");
      return { sold: true, signature: "sigsell", outLamports: BigInt(12_000_000) };
    };
    await runLiveCycle(again, seller, async () => [candidate()], env, 10_000);
    setLiveBot(again, false);
    await runLiveCycle(again, seller, async () => [candidate()], env, 20_000);
    expect(readLiveFile(again).positions).toHaveLength(0);
    expect(readLiveFile(again).notice).toMatch(/0\.0120 SOL/);
    const journal = fs.readFileSync(path.join(again, "intents.jsonl"), "utf8");
    expect(journal).toContain("\"kind\":\"sell\"");
    expect(journal).toContain("sigsell");
    expect(journal).not.toContain(fs.readFileSync(path.join(again, "wallet.json"), "utf8").slice(0, 24));
  });

  it("pushes the open-position snapshot once every 15 minutes and not while the bot is off", async () => {
    const env = { TELEGRAM_BOT_TOKEN: "SECRET", TELEGRAM_CHAT_ID: "42" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const off = tempDir();
    createDedicatedWallet(off);
    await sendLiveDigest(off, env, 1_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readLiveFile(off).digestAt).toBeNull();

    const dir = tempDir();
    createDedicatedWallet(dir);
    setLiveBot(dir, true);
    await sendLiveDigest(dir, env, 1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { text: string };
    expect(body.text).toContain("0 abiertas");
    expect(body.text).not.toContain("SECRET");
    expect(readLiveFile(dir).digestAt).toBe(1_000);
    await sendLiveDigest(dir, env, 1_000 + 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await sendLiveDigest(dir, env, 1_000 + 15 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readLiveFile(dir).digestAt).toBe(1_000 + 15 * 60 * 1000);
  });
});
