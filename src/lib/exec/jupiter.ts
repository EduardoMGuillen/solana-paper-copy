/**
 * Read-only Jupiter quotes for shadow mode.
 *
 * Calls Swap API v2 `GET /order` WITHOUT a `taker`, so Jupiter returns
 * pricing only and no transaction: nothing here can sign or send a swap.
 */

export type JupiterConfig = { apiKey: string; baseUrl: string };

export type JupiterQuote = {
  inAmount: number;
  outAmount: number;
  priceImpactPct: number | null;
  router: string | null;
};

export function jupiterConfig(env: Record<string, string | undefined> = process.env): JupiterConfig | null {
  const apiKey = env.JUPITER_API_KEY?.trim();
  if (env.LIVE_MODE?.trim() !== "shadow" || !apiKey) return null;
  return { apiKey, baseUrl: (env.JUPITER_API_URL?.trim() || "https://api.jup.ag/swap/v2").replace(/\/$/, "") };
}

const n = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export function parseOrder(body: unknown): JupiterQuote {
  const b = (body ?? {}) as Record<string, unknown>;
  const error = b.error ?? b.errorMessage ?? b.errorCode;
  if (error) throw new Error(`Jupiter: ${String(b.errorMessage ?? b.error ?? b.errorCode)}`);
  const inAmount = n(b.inAmount);
  const outAmount = n(b.outAmount);
  if (!(inAmount > 0) || !(outAmount > 0)) throw new Error("Jupiter: cotización sin montos válidos");
  const impact = n(b.priceImpactPct ?? b.priceImpact);
  return {
    inAmount,
    outAmount,
    priceImpactPct: Number.isFinite(impact) ? impact : null,
    router: typeof b.router === "string" ? b.router : null,
  };
}

export async function getQuote(
  config: JupiterConfig,
  request: { inputMint: string; outputMint: string; amount: number },
): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: String(Math.max(1, Math.floor(request.amount))),
  });
  const response = await fetch(`${config.baseUrl}/order?${params}`, {
    headers: { "x-api-key": config.apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Jupiter respondió ${response.status}: ${text.slice(0, 160)}`);
  return parseOrder(JSON.parse(text));
}

/** Token decimals from chain. Throws if the mint does not exist. */
export async function getDecimals(mint: string, rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"): Promise<number> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [mint] }),
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await response.json()) as { result?: { value?: { decimals?: number } }; error?: { message?: string } };
  const decimals = body.result?.value?.decimals;
  if (typeof decimals !== "number") throw new Error(body.error?.message || `Mint ${mint} sin decimales`);
  return decimals;
}
