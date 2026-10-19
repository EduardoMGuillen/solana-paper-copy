import { afterEach, describe, expect, it, vi } from "vitest";
import { createBotState } from "../bot/engine";
import { defaultBotSettings } from "../bot/settings";
import { getQuote, jupiterConfig, parseOrder } from "./jupiter";
import { applyShadowOutcome, planShadowJobs, runShadowJobs } from "./runner";
import { costBps, effectivePrice, shadowVerdict, summarizeShadow, type ShadowQuote } from "./shadow";
import { MARKET_TOKENS, USDC } from "./tokens";

const config = { apiKey: "KEY", baseUrl: "https://api.jup.ag/swap/v2" };

function state() {
  const s = createBotState(0, { ...defaultBotSettings, markets: ["SOL", "JUP"] }, 100);
  s.books[0].lastPrice = 100;
  s.books[1].lastPrice = 0.5;
  return s;
}

describe("jupiter config and parsing", () => {
  it("is on only with LIVE_MODE=shadow and an API key", () => {
    expect(jupiterConfig({ JUPITER_API_KEY: "k" })).toBeNull();
    expect(jupiterConfig({ LIVE_MODE: "live", JUPITER_API_KEY: "k" })).toBeNull();
    expect(jupiterConfig({ LIVE_MODE: "shadow" })).toBeNull();
    expect(jupiterConfig({ LIVE_MODE: "shadow", JUPITER_API_KEY: "k" })?.baseUrl).toBe("https://api.jup.ag/swap/v2");
  });

  it("parses string amounts and either price-impact field name", () => {
    expect(parseOrder({ inAmount: "1000000", outAmount: "9950", priceImpactPct: "-0.001", router: "iris" })).toEqual({
      inAmount: 1_000_000,
      outAmount: 9_950,
      priceImpactPct: -0.001,
      router: "iris",
    });
    expect(parseOrder({ inAmount: 1, outAmount: 2, priceImpact: 0.5 }).priceImpactPct).toBe(0.5);
    expect(() => parseOrder({ error: "No routes found" })).toThrow(/No routes/);
    expect(() => parseOrder({ inAmount: "0", outAmount: "5" })).toThrow();
  });

  afterEach(() => vi.restoreAllMocks());

  it("asks for a quote WITHOUT a taker, so no transaction can come back to sign", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ inAmount: "1", outAmount: "2" })));
    await getQuote(config, { inputMint: USDC.mint, outputMint: MARKET_TOKENS.SOL.mint, amount: 20_000_000.7 });
    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.pathname).toBe("/swap/v2/order");
    expect(u.searchParams.get("taker")).toBeNull();
    expect(u.searchParams.get("amount")).toBe("20000000");
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("KEY");
  });
});

describe("shadow cost math", () => {
  it("turns raw amounts into a USD price and a cost per side", () => {
    // Pay 20 USDC, receive 0.199 SOL → 100.50 US$/SOL against a 100 mark = 50 bps.
    const buy = effectivePrice("buy", 20_000_000, 199_000_000, 9);
    expect(buy).toBeCloseTo(100.5025, 3);
    expect(costBps("buy", 100, buy)).toBeCloseTo(50.25, 1);
    // Sell 0.2 SOL for 19.9 USDC → 99.5 → 50 bps.
    const sell = effectivePrice("sell", 200_000_000, 19_900_000, 9);
    expect(costBps("sell", 100, sell)).toBeCloseTo(50, 5);
  });

  it("summarizes medians per market and judges against the assumed cost", () => {
    const q = (market: string, side: "buy" | "sell", cost: number, suspicious = false): ShadowQuote => ({
      t: 0, market, kind: "probe", side, usd: 20, mark: 1, effPrice: 1, costBps: cost, priceImpactPct: null, router: null, suspicious,
    });
    const rows = summarizeShadow([q("SOL", "buy", 5), q("SOL", "buy", 7), q("SOL", "sell", 6), q("SOL", "buy", 900, true)]);
    expect(rows[0]).toMatchObject({ market: "SOL", n: 3, buyMedian: 7, sellMedian: 6, suspicious: 1 });
    expect(shadowVerdict(rows, 20)?.ok).toBe(true);
    expect(shadowVerdict(rows, 5)?.ok).toBe(false);
  });
});

describe("shadow runner", () => {
  afterEach(() => vi.restoreAllMocks());

  it("drains paper fills and probes each market once per hour", () => {
    const s = state();
    s.fillQueue = [{ t: 1, market: "SOL", side: "buy", usd: 20, qty: 0.2, paperPrice: 100 }];
    const jobs = planShadowJobs(s, 10_000_000);
    expect(jobs.filter((j) => j.kind === "trade")).toHaveLength(1);
    expect(jobs.filter((j) => j.kind === "probe")).toHaveLength(4);
    expect(s.fillQueue).toEqual([]);
    expect(planShadowJobs(s, 10_000_000 + 60_000)).toHaveLength(0);
  });

  it("quotes through Jupiter, reads decimals from chain, and flags a price that disagrees with Binance", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") return new Response(JSON.stringify({ result: { value: { decimals: 9 } } }));
      const p = new URL(url).searchParams;
      // SOL buy: 20 USDC → 0.199 SOL. JUP buy: absurd price (wrong mint).
      if (p.get("outputMint") === MARKET_TOKENS.SOL.mint) return new Response(JSON.stringify({ inAmount: p.get("amount"), outAmount: "199000000" }));
      return new Response(JSON.stringify({ inAmount: p.get("amount"), outAmount: "1" }));
    });
    const outcome = await runShadowJobs(
      [
        { market: "SOL", kind: "trade", side: "buy", usd: 20, mark: 100 },
        { market: "JUP", kind: "probe", side: "buy", usd: 20, mark: 0.5 },
      ],
      config,
      {},
      () => 5,
    );
    expect(outcome.errors).toEqual([]);
    expect(outcome.quotes[0].costBps).toBeCloseTo(50.25, 1);
    expect(outcome.quotes[0].suspicious).toBe(false);
    expect(outcome.quotes[1].suspicious).toBe(true);
    expect(outcome.decimals[MARKET_TOKENS.SOL.mint]).toBe(9);
  });

  it("alerts when a real trade would cost more than twice the assumption", () => {
    const s = state();
    s.notifiedSeq = s.seq;
    const base = { t: 1, kind: "trade" as const, side: "buy" as const, usd: 20, mark: 1, effPrice: 1, priceImpactPct: null, router: null, suspicious: false };
    applyShadowOutcome(s, { quotes: [{ ...base, market: "SOL", costBps: 10 }, { ...base, market: "JUP", costBps: 90 }], decimals: {}, errors: [] }, 2);
    const alerts = s.log.filter((l) => l.alert && l.text.startsWith("Sombra"));
    expect(alerts.map((l) => l.market)).toEqual(["JUP"]);
    expect(s.shadow?.quotes).toHaveLength(2);
  });
});
