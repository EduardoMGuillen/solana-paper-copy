import { applyFill, applyProtectiveStops, createInitialState, snapshot } from "./engine";
import type { EngineState, Leader, LeaderFill } from "./types";

export const PAPER = {
  AURA: { mint: "PaperAURA111111111111111111111111111111111", symbol: "AURA" },
  BRUMA: { mint: "PaperBRUMA11111111111111111111111111111111", symbol: "BRUMA" },
  CIMA: { mint: "PaperCIMA111111111111111111111111111111111", symbol: "CIMA" },
  DUNA: { mint: "PaperDUNA111111111111111111111111111111111", symbol: "DUNA" },
  ECO: { mint: "PaperECO1111111111111111111111111111111111", symbol: "ECO" },
} as const;

const DRIFT: Record<string, number> = {
  [PAPER.AURA.mint]: 0.022,
  [PAPER.BRUMA.mint]: 0,
  [PAPER.CIMA.mint]: 0,
  [PAPER.DUNA.mint]: -0.045,
  [PAPER.ECO.mint]: -0.045,
};

const NOISE: Record<string, number> = {
  [PAPER.AURA.mint]: 0,
  [PAPER.BRUMA.mint]: 0.04,
  [PAPER.CIMA.mint]: 0.04,
  [PAPER.DUNA.mint]: 0,
  [PAPER.ECO.mint]: 0,
};

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function heldMint(leader: Leader): string | undefined {
  return Object.keys(leader.book).find((mint) => leader.book[mint].qty > 0);
}

function buy(
  leader: Leader,
  token: { mint: string; symbol: string },
  solNotional: number,
  price: number,
  now: number,
): LeaderFill {
  const before = leader.book[token.mint]?.qty ?? 0;
  const qty = solNotional / price;
  return {
    leaderId: leader.id,
    mint: token.mint,
    symbol: token.symbol,
    side: "buy",
    leaderQtyBefore: before,
    leaderQtyAfter: before + qty,
    fillPriceSol: price,
    fillTime: now,
    observedAt: now,
    currentPriceSol: price,
    leaderNotionalSol: solNotional,
  };
}

function sell(
  leader: Leader,
  token: { mint: string; symbol: string },
  fraction: number,
  price: number,
  now: number,
): LeaderFill | null {
  const before = leader.book[token.mint]?.qty ?? 0;
  if (!(before > 0)) return null;
  return {
    leaderId: leader.id,
    mint: token.mint,
    symbol: token.symbol,
    side: "sell",
    leaderQtyBefore: before,
    leaderQtyAfter: before * (1 - fraction),
    fillPriceSol: price,
    fillTime: now,
    observedAt: now,
    currentPriceSol: price,
    leaderNotionalSol: before * fraction * price,
  };
}

function tokenByMint(mint: string): { mint: string; symbol: string } {
  return (
    Object.values(PAPER).find((token) => token.mint === mint) ?? {
      mint,
      symbol: mint.slice(0, 4),
    }
  );
}

function plan(state: EngineState, leader: Leader, now: number, rng: () => number): LeaderFill | null {
  const priceOf = (mint: string) => state.prices[mint] ?? 0;
  if (leader.personality === "consistent") {
    const token = PAPER.AURA;
    if (!heldMint(leader)) {
      leader.holdTicks = 0;
      return buy(leader, token, 8, priceOf(token.mint), now);
    }
    leader.holdTicks += 1;
    if (leader.holdTicks === 4) return sell(leader, token, 0.5, priceOf(token.mint), now);
    if (leader.holdTicks >= 8) {
      leader.holdTicks = 0;
      return sell(leader, token, 1, priceOf(token.mint), now);
    }
    return null;
  }

  if (leader.personality === "choppy") {
    const mint = heldMint(leader);
    if (!mint) {
      leader.holdTicks = 0;
      const token = state.demoTick % 2 === 0 ? PAPER.BRUMA : PAPER.CIMA;
      return buy(leader, token, 6, priceOf(token.mint), now);
    }
    leader.holdTicks += 1;
    if (leader.holdTicks < 3) return null;
    const fraction = rng() < 0.5 ? 0.5 : 1;
    if (fraction === 1) leader.holdTicks = 0;
    return sell(leader, tokenByMint(mint), fraction, priceOf(mint), now);
  }

  const mint = heldMint(leader);
  if (!mint) {
    leader.holdTicks = 0;
    const token = state.demoTick % 2 === 0 ? PAPER.DUNA : PAPER.ECO;
    return buy(leader, token, 30, priceOf(token.mint), now);
  }
  leader.holdTicks += 1;
  if (leader.holdTicks < 3) return null;
  leader.holdTicks = 0;
  return sell(leader, tokenByMint(mint), 1, priceOf(mint), now);
}

function driftPrices(state: EngineState, rng: () => number): void {
  for (const mint of Object.values(PAPER).map((token) => token.mint)) {
    const price = state.prices[mint];
    if (!(price > 0)) continue;
    const shock = (rng() - 0.5) * 2 * (NOISE[mint] ?? 0);
    state.prices[mint] = Math.max(1e-8, price * (1 + (DRIFT[mint] ?? 0) + shock));
  }
}

export function stepDemo(state: EngineState, now: number): void {
  state.demoTick += 1;
  const rng = mulberry32((state.demoTick * 1103515245 + 12345) >>> 0);
  driftPrices(state, rng);
  for (const leader of state.leaders) {
    if (leader.kind !== "demo" || !leader.personality) continue;
    const fill = plan(state, leader, now, rng);
    if (fill) applyFill(state, fill);
  }
  applyProtectiveStops(state, now);
  snapshot(state, now);
}

export function createSeededState(now: number): EngineState {
  const start = now - 20 * 4_000;
  const state = createInitialState(start);
  for (let index = 1; index <= 20; index += 1) {
    stepDemo(state, start + index * 4_000);
  }
  state.updatedAt = now;
  return state;
}
