import type { LeaderFill } from "./engine/types";

const WSOL = "So11111111111111111111111111111111111111112";

type RpcTransaction = {
  blockTime?: number | null;
  meta?: {
    fee?: number;
    preBalances?: number[];
    postBalances?: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  } | null;
  transaction?: {
    message?: {
      accountKeys?: Array<string | { pubkey?: string }>;
    };
  };
};

type TokenBalance = {
  mint?: string;
  owner?: string;
  uiTokenAmount?: { uiAmount?: number | null };
};

export function parseWalletSwap(
  tx: RpcTransaction,
  wallet: string,
  signature: string,
  now: number,
): LeaderFill | null {
  const keys = tx.transaction?.message?.accountKeys ?? [];
  const index = keys.findIndex((key) =>
    (typeof key === "string" ? key : key.pubkey) === wallet,
  );
  if (index < 0) return null;
  const pre = tx.meta?.preBalances?.[index];
  const post = tx.meta?.postBalances?.[index];
  if (pre === undefined || post === undefined) return null;
  const solDelta = (post - pre) / 1e9;

  const totals = new Map<string, { pre: number; post: number }>();
  const absorb = (rows: TokenBalance[] | undefined, side: "pre" | "post") => {
    for (const row of rows ?? []) {
      if (row.owner !== wallet || !row.mint || row.mint === WSOL) continue;
      const current = totals.get(row.mint) ?? { pre: 0, post: 0 };
      current[side] += row.uiTokenAmount?.uiAmount ?? 0;
      totals.set(row.mint, current);
    }
  };
  absorb(tx.meta?.preTokenBalances, "pre");
  absorb(tx.meta?.postTokenBalances, "post");

  let mint = "";
  let delta = 0;
  let before = 0;
  let after = 0;
  for (const [candidate, amounts] of totals) {
    const change = amounts.post - amounts.pre;
    if (Math.abs(change) > Math.abs(delta)) {
      mint = candidate;
      delta = change;
      before = amounts.pre;
      after = amounts.post;
    }
  }
  if (!mint || delta === 0 || solDelta === 0) return null;
  if (Math.sign(delta) === Math.sign(solDelta)) return null;
  const price = Math.abs(solDelta) / Math.abs(delta);
  if (!Number.isFinite(price) || price <= 0) return null;
  const fillTime = (tx.blockTime ?? Math.floor(now / 1000)) * 1000;
  return {
    leaderId: "",
    mint,
    symbol: mint.slice(0, 4),
    side: delta > 0 ? "buy" : "sell",
    leaderQtyBefore: before,
    leaderQtyAfter: after,
    fillPriceSol: price,
    fillTime,
    observedAt: now,
    currentPriceSol: price,
    leaderNotionalSol: Math.abs(solDelta),
    signature,
  };
}

type RpcResponse<T> = { result?: T; error?: { message?: string } };

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const endpoint = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 429) {
    throw new Error("El RPC público limitó las consultas (429). El modo demo sigue activo.");
  }
  if (!response.ok) {
    throw new Error(`El RPC respondió ${response.status}. El modo demo sigue activo.`);
  }
  const body = (await response.json()) as RpcResponse<T>;
  if (body.error) {
    throw new Error(body.error.message || "El RPC rechazó la consulta. El modo demo sigue activo.");
  }
  return body.result as T;
}

export async function pollWalletSwaps(
  wallet: string,
  seen: string[],
  now: number,
): Promise<{ fills: LeaderFill[]; seen: string[] }> {
  const signatures = await rpc<Array<{ signature: string }>>("getSignaturesForAddress", [
    wallet,
    { limit: 8 },
  ]);
  const known = new Set(seen);
  const fresh = (signatures ?? []).map((item) => item.signature).filter((signature) => !known.has(signature));
  const fills: LeaderFill[] = [];
  const nextSeen = [...seen];
  for (const signature of fresh.slice(0, 3).reverse()) {
    nextSeen.push(signature);
    try {
      const tx = await rpc<RpcTransaction | null>("getTransaction", [
        signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
      ]);
      if (!tx) continue;
      const fill = parseWalletSwap(tx, wallet, signature, now);
      if (fill) fills.push(fill);
    } catch {
      // One bad transaction should not fail the whole poll.
    }
  }
  return { fills, seen: nextSeen.slice(-200) };
}
