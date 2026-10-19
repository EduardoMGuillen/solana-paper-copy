import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STARTING_USD } from "./engine/constants";
import { applyFill, createInitialState, flattenOpenPositions, markEquity } from "./engine/engine";
import { assembleDataset, readDataset, writeEffectiveness } from "./effectiveness";
import { flattenAndFlush } from "./shutdown";
import { saveState } from "./store";

const previousDataDir = process.env.PAPER_DATA_DIR;

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.PAPER_DATA_DIR;
  else process.env.PAPER_DATA_DIR = previousDataDir;
});

describe("effectiveness dataset", () => {
  it("scores return against the 100 dollar start and keeps session stop", () => {
    const state = createInitialState(8_000_000);
    state.cashSol = 110;
    const saved = assembleDataset({
      state,
      previous: null,
      now: 8_100_000,
      pid: 42,
      sessionId: "sesion-prueba",
      closing: true,
      replace: false,
    });
    expect(saved.startingEquity).toBe(STARTING_USD);
    expect(saved.totalReturn).toBeCloseTo((markEquity(state) - 100) / 100);
    expect(saved.sessions).toEqual([
      { id: "sesion-prueba", pid: 42, start: 8_100_000, stop: 8_100_000 },
    ]);
    expect(saved.currency).toBe("USD");
  });

  it("closes a session from a dead process and appends the new one", () => {
    const state = createInitialState(9_000_000);
    const saved = assembleDataset({
      state,
      previous: {
        version: 1,
        currency: "USD",
        path: "data/effectiveness.json",
        startingEquity: 100,
        accountCreatedAt: state.createdAt,
        sessions: [{ id: "vieja", pid: 7, start: 1, stop: null }],
        trades: [],
        equityCurve: [],
        drawdownCurve: [],
        winRate: null,
        profitFactor: null,
        profitFactorUnbounded: false,
        maxDrawdown: 0,
        totalReturn: 0,
        equity: 100,
        closed: 0,
        updatedAt: 2,
      },
      now: 9_100_000,
      pid: 99,
      sessionId: "nueva",
      closing: false,
      replace: false,
    });
    expect(saved.sessions[0]).toMatchObject({ id: "vieja", stop: 2 });
    expect(saved.sessions[1]).toMatchObject({ id: "nueva", pid: 99, stop: null });
  });

  it("flushes flattened closes before the shutdown promise resolves", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "paper-flat-"));
    process.env.PAPER_DATA_DIR = dir;
    const state = createInitialState(6_000_000);
    applyFill(state, {
      leaderId: "lumen",
      mint: "PaperAURA111111111111111111111111111111111",
      symbol: "AURA",
      side: "buy",
      leaderQtyBefore: 0,
      leaderQtyAfter: 10,
      fillPriceSol: 1,
      fillTime: 6_000_000,
      observedAt: 6_000_000,
      currentPriceSol: 1,
      leaderNotionalSol: 50,
    });
    expect(state.positions).toHaveLength(1);
    await saveState(state);

    const result = await flattenAndFlush();
    expect(result.closed).toBe(1);
    expect(result.datasetPath).toBe("data/effectiveness.json");

    const raw = await readFile(path.join(dir, "effectiveness.json"), "utf8");
    const dataset = JSON.parse(raw) as { trades: { side: string; reason: string; fees: number; slippage: number; pnl: number | null }[]; sessions: { stop: number | null }[]; startingEquity: number };
    expect(dataset.startingEquity).toBe(100);
    expect(dataset.sessions.at(-1)?.stop).not.toBeNull();
    const close = dataset.trades.find((trade) => trade.reason === "apagado");
    expect(close?.side).toBe("sell");
    expect(close?.fees).toBeGreaterThan(0);
    expect(close?.slippage).toBeGreaterThan(0);
    expect(close?.pnl).not.toBeNull();

    const reread = await readDataset();
    expect(reread?.trades.some((trade) => trade.reason === "apagado")).toBe(true);
    const reloaded = JSON.parse(await readFile(path.join(dir, "paper-state.json"), "utf8")) as {
      positions: unknown[];
    };
    expect(reloaded.positions).toHaveLength(0);
  });

  it("writes the dataset and reads back the same summary", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "paper-set-"));
    process.env.PAPER_DATA_DIR = dir;
    const state = createInitialState(7_000_000);
    flattenOpenPositions(state, 7_000_000);
    const saved = await writeEffectiveness(state, { closing: true });
    expect(saved.startingEquity).toBe(100);
    expect(saved.sessions[0]?.stop).toBeTypeOf("number");
    const again = await readDataset();
    expect(again?.totalReturn).toBeCloseTo(saved.totalReturn);
    expect(again?.equity).toBeCloseTo(saved.equity);
  });
});
