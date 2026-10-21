import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertOutsideRepo,
  createDedicatedWallet,
  decodeBase58,
  encodeBase58,
  parseLamports,
  closeLivePosition,
  readLiveRunning,
  readWalletAddress,
  saveLiveParams,
  setLiveBot,
  signingBlocked,
  walletStatus,
  withSolUsd,
  type WalletStatus,
} from "./wallet";
import { PAPER_LIVE_PARAMS } from "./live-params";
import { DECODER_SHAPE } from "../lp/bidask";
import { METEORA_NEXT_SLOT } from "../lp/livebook";
import { DECODER_EXITS, DECODER_RULES } from "../lp/meteora";

const WSOL = "So11111111111111111111111111111111111111112";
const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wallet-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("wallet address", () => {
  it("round-trips the wrapped SOL mint", () => {
    const bytes = decodeBase58(WSOL);
    expect(bytes).toHaveLength(32);
    expect(encodeBase58(bytes)).toBe(WSOL);
  });

  it("rejects a symbol that is not base58", () => {
    expect(() => decodeBase58("0OIl")).toThrow(/inválida/);
  });
});

describe("dedicated wallet", () => {
  it("writes the secret outside the project and the address matches the public half", () => {
    const dir = tempDir();
    const address = createDedicatedWallet(dir);
    expect(readWalletAddress(dir)).toBe(address);
    expect(decodeBase58(address)).toHaveLength(32);
    const secret = JSON.parse(fs.readFileSync(path.join(dir, "wallet.json"), "utf8")) as number[];
    expect(secret).toHaveLength(64);
    expect(encodeBase58(Uint8Array.from(secret.slice(32)))).toBe(address);
    expect(fs.readFileSync(path.join(dir, "intents.jsonl"), "utf8")).toBe("");
  });

  it("does not replace a wallet that already exists", () => {
    const dir = tempDir();
    const first = createDedicatedWallet(dir);
    expect(createDedicatedWallet(dir)).toBe(first);
  });

  it("refuses to create a key inside the repository", () => {
    expect(() => assertOutsideRepo(path.join(process.cwd(), "data"))).toThrow(/dentro del proyecto/);
    expect(() => createDedicatedWallet(path.join(process.cwd(), "data"))).toThrow(/dentro del proyecto/);
  });

  it("reads the address even if the secret file is unreadable garbage", () => {
    const dir = tempDir();
    const address = createDedicatedWallet(dir);
    fs.writeFileSync(path.join(dir, "wallet.json"), "no abrir", "utf8");
    expect(readWalletAddress(dir)).toBe(address);
  });
});

describe("live window status", () => {
  it("signs only while this window is running", () => {
    expect(signingBlocked(false)).toMatch(/no firma/);
    expect(signingBlocked(false, true)).toMatch(/firma aperturas/);
    expect(signingBlocked(true)).toMatch(/Corte de emergencia/);
    for (const mode of ["paper", "shadow", "live"]) {
      expect(signingBlocked(false)).not.toContain(mode);
    }
  });

  it("reports the public address and a zero balance without the secret", async () => {
    const dir = tempDir();
    const address = createDedicatedWallet(dir);
    const secret = fs.readFileSync(path.join(dir, "wallet.json"), "utf8");
    const status = await walletStatus(
      { WALLET_DIR: dir, LIVE_MODE: "live", LIVE_LP_MAX_SOL: "0.3" },
      async () => ({ ok: true, json: async () => ({ result: { value: 0 } }) }),
    );
    expect(status.ready).toBe(true);
    expect(status.address).toBe(address);
    expect(status.balanceSol).toBe(0);
    expect(status.signing).toBe(false);
    expect(status.limits.lpMaxSol).toBe(0.3);
    expect(status.limits.liveMode).toBe("live");
    expect(JSON.stringify(status)).not.toContain(secret.slice(0, 24));
  });

  it("shows the address when the RPC fails and does not throw", async () => {
    const dir = tempDir();
    const address = createDedicatedWallet(dir);
    const status = await walletStatus({ WALLET_DIR: dir }, async () => {
      throw new Error("red caída");
    });
    expect(status.address).toBe(address);
    expect(status.balanceSol).toBeNull();
    expect(status.error).toBe("red caída");
    expect(status.signing).toBe(false);
  });

  it("sees a KILL file without opening a position", async () => {
    const dir = tempDir();
    createDedicatedWallet(dir);
    fs.writeFileSync(path.join(dir, "KILL"), "", "utf8");
    const status = await walletStatus({ WALLET_DIR: dir }, async () => ({ ok: true, json: async () => ({ result: { value: 0 } }) }));
    expect(status.kill).toBe(true);
    expect(status.signing).toBe(false);
    expect(status.reason).toMatch(/Corte/);
  });

  it("starts and stops without signing, and a KILL file keeps it stopped", async () => {
    const dir = tempDir();
    createDedicatedWallet(dir);
    expect(readLiveRunning(dir)).toBe(false);
    expect(setLiveBot(dir, true)).toEqual({ running: true, error: null });
    expect(readLiveRunning(dir)).toBe(true);
    const started = await walletStatus({ WALLET_DIR: dir }, async () => ({ ok: true, json: async () => ({ result: { value: 0 } }) }));
    expect(started.running).toBe(true);
    expect(started.signing).toBe(true);
    expect(setLiveBot(dir, false).running).toBe(false);
    fs.writeFileSync(path.join(dir, "KILL"), "", "utf8");
    expect(setLiveBot(dir, true)).toEqual({ running: false, error: "Corte de emergencia activo. El bot sigue apagado." });
    const blocked = await walletStatus({ WALLET_DIR: dir }, async () => ({ ok: true, json: async () => ({ result: { value: 0 } }) }));
    expect(blocked.running).toBe(false);
    expect(blocked.signing).toBe(false);
  });

  it("keeps the paper defaults and refuses edits while the bot is running", async () => {
    expect(PAPER_LIVE_PARAMS).toEqual({
      slot: METEORA_NEXT_SLOT,
      minTvl: DECODER_RULES.minTvl,
      minFees24h: DECODER_RULES.minFees24h,
      minBaseFeePct: DECODER_RULES.minBaseFeePct,
      minVolume1h: DECODER_RULES.minVolume1h,
      takeProfit: DECODER_EXITS.takeProfit,
      stopLoss: DECODER_EXITS.stopLoss,
      holdHours: DECODER_EXITS.holdHours,
      range: DECODER_SHAPE.range,
      binStep: DECODER_SHAPE.binStep,
    });
    const dir = tempDir();
    createDedicatedWallet(dir);
    const saved = saveLiveParams(dir, { ...PAPER_LIVE_PARAMS, slot: 0.25, takeProfit: 5 });
    expect(saved.error).toBeNull();
    expect(saved.params.slot).toBe(0.25);
    expect(saved.params.takeProfit).toBe(1);
    expect(setLiveBot(dir, true).running).toBe(true);
    const blocked = saveLiveParams(dir, { slot: 0.5 });
    expect(blocked.error).toMatch(/Para el bot/);
    expect(blocked.params.slot).toBe(0.25);
    const status = await walletStatus({ WALLET_DIR: dir }, async () => ({ ok: true, json: async () => ({ result: { value: 0 } }) }));
    expect(status.running).toBe(true);
    expect(status.params.slot).toBe(0.25);
    expect(status.signing).toBe(true);
  });

  it("stop closes every open position and a manual close leaves the bot running", async () => {
    const dir = tempDir();
    createDedicatedWallet(dir);
    const pool = "EQEu6NyEq8nECAiem1YkTu3uDBiGTEA2tYBLBmr9YJ7Y";
    const other = "95zNQQ8juGpu8odzpbp63ZNtXuTnnBeBsHovUjpe32d8";
    fs.writeFileSync(
      path.join(dir, "bot.json"),
      JSON.stringify({
        running: true,
        params: PAPER_LIVE_PARAMS,
        positions: [
          { address: pool, name: "WEFT-SOL", stakeSol: 0.1, openedAt: 1, signature: "sig-a", closing: false, closeReason: null, tokenPct: -0.1, positionPct: 0.02, note: "" },
          { address: other, name: "Kimchi-SOL", stakeSol: 0.1, openedAt: 1, signature: "sig-b", closing: false, closeReason: null, tokenPct: null, positionPct: null, note: "" },
        ],
      }),
      "utf8",
    );
    expect(closeLivePosition(dir, pool).error).toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(dir, "bot.json"), "utf8")).notice).toMatch(/se puede volver a abrir/);
    const afterOne = await walletStatus({ WALLET_DIR: dir }, async () => ({ ok: true, json: async () => ({ result: { value: 0 } }) }));
    expect(afterOne.running).toBe(true);
    expect(afterOne.positions.find((position) => position.address === pool)?.closeReason).toBe("manual");
    expect(afterOne.positions.find((position) => position.address === other)?.closing).toBe(false);
    expect(setLiveBot(dir, false).running).toBe(false);
    const afterStop = await walletStatus({ WALLET_DIR: dir }, async () => ({ ok: true, json: async () => ({ result: { value: 0 } }) }));
    expect(afterStop.running).toBe(false);
    expect(afterStop.positions.every((position) => position.closeReason === "stop")).toBe(true);
    expect(afterStop.positions).toHaveLength(2);
  });

  it("values the SOL balance in dollars and leaves it blank without a price", () => {
    const bare = {
      ready: true,
      address: null,
      balanceSol: 0.5,
      solUsd: null,
      balanceUsd: null,
      lamports: null,
      signing: false as const,
      running: false,
      params: { ...PAPER_LIVE_PARAMS },
      positions: [],
      notice: null,
      reason: "",
      kill: false,
      journal: 0,
      limits: { liveMode: "paper", lpMaxSol: 0.3, minReserveSol: 0.03 },
      error: null,
    } satisfies WalletStatus;
    expect(withSolUsd(bare, 180).balanceUsd).toBe(90);
    expect(withSolUsd(bare, null).balanceUsd).toBeNull();
    expect(withSolUsd({ ...bare, balanceSol: null }, 180).balanceUsd).toBeNull();
  });

  it("parses a lamport balance and rejects an RPC error", () => {
    expect(parseLamports({ result: { value: 1_500_000_000 } })).toBe(1_500_000_000);
    expect(() => parseLamports({ error: { message: "no" } })).toThrow(/no/);
  });
});
