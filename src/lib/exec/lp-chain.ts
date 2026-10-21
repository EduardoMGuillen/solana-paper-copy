/**
 * The only module that opens wallet.json. It signs Meteora liquidity
 * transactions for the dedicated wallet and nothing else.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { DEFAULT_RPC, encodeBase58, readWalletAddress } from "./wallet";
import { WSOL } from "../lp/meteora";
import type { LivePosition } from "./live-book";
import { BIN_ARRAY_RENT_LAMPORTS, MAX_OPEN_PRICE_DRIFT, positionValue, solPerToken, type OpenOrder, type PositionMark } from "./lp-plan";
import { decideSell, impactTooHigh } from "./sell-rule";

export type SentOpen = { signature: string; position: string; minBinId: number; maxBinId: number; entryPrice: number };

export type SellResult = { sold: true; signature: string; outLamports: bigint } | { sold: false; reason: string };

/** Enough to find and sell the token a closed position left behind. */
export type SellTarget = Pick<LivePosition, "address" | "name" | "tokenMint" | "solIsY">;

/**
 * `onSigned` runs after a transaction is signed and before it is broadcast,
 * so the journal knows the signature even if the send or the confirm fails.
 */
export type LiveChain = {
  balanceLamports(owner: string): Promise<number>;
  landed(signature: string): Promise<boolean>;
  /** The subset of these position accounts that exist on chain. */
  existing(positions: string[]): Promise<Set<string>>;
  /** On-chain value of one open position, fees included. */
  inspect(position: LivePosition): Promise<PositionMark>;
  open(order: OpenOrder, onSigned: (sent: SentOpen) => void): Promise<SentOpen>;
  close(position: LivePosition, onSigned: (signature: string) => void): Promise<string>;
  /** Swap the token left by a close back to SOL. A skip does not undo the close. */
  sell(target: SellTarget, onSigned: (signature: string) => void): Promise<SellResult>;
};

type DlmmMint = { mintAuthority: PublicKey | null; freezeAuthority: PublicKey | null; decimals: number };

type DlmmPool = {
  pubkey: PublicKey;
  program: { programId: PublicKey };
  tokenX: { publicKey: PublicKey; mint: DlmmMint };
  tokenY: { publicKey: PublicKey; mint: DlmmMint };
  getActiveBin(): Promise<{ binId: number; pricePerToken: string }>;
  getPosition(position: PublicKey): Promise<{
    positionData: { totalXAmount: string; totalYAmount: string; feeX: { toString(): string }; feeY: { toString(): string } };
  }>;
  getBinArrayForSwap(swapForY: boolean): Promise<unknown[]>;
  swapQuote(inAmount: BN, swapForY: boolean, allowedSlippage: BN, binArrays: unknown[]): { outAmount: BN; minOutAmount: BN; priceImpact: { toString(): string }; binArraysPubkey: PublicKey[] };
  swap(args: {
    inToken: PublicKey;
    outToken: PublicKey;
    inAmount: BN;
    minOutAmount: BN;
    lbPair: PublicKey;
    user: PublicKey;
    binArraysPubkey: PublicKey[];
  }): Promise<Transaction>;
  initializePositionAndAddLiquidityByStrategy(args: {
    positionPubKey: PublicKey;
    user: PublicKey;
    totalXAmount: BN;
    totalYAmount: BN;
    strategy: { minBinId: number; maxBinId: number; strategyType: number };
    slippage?: number;
  }): Promise<Transaction>;
  removeLiquidity(args: {
    user: PublicKey;
    position: PublicKey;
    fromBinId: number;
    toBinId: number;
    bps: BN;
    shouldClaimAndClose?: boolean;
  }): Promise<Transaction[]>;
};

function loadKeypair(dir: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "wallet.json"), "utf8")) as unknown;
  if (!Array.isArray(raw) || raw.length !== 64 || raw.some((part) => typeof part !== "number" || part < 0 || part > 255)) {
    throw new Error("La wallet dedicada no se puede leer.");
  }
  const pair = Keypair.fromSecretKey(Uint8Array.from(raw));
  const expected = readWalletAddress(dir);
  if (!expected || pair.publicKey.toBase58() !== expected) throw new Error("La clave no corresponde a la dirección publicada.");
  return pair;
}

function connection(env: Record<string, string | undefined>): Connection {
  return new Connection(env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC, "confirmed");
}

type DlmmSdk = {
  create: (connection: Connection, pool: PublicKey) => Promise<DlmmPool>;
  StrategyType: { BidAsk: number };
  getBinArrayKeysCoverage: (lowerBinId: BN, upperBinId: BN, lbPair: PublicKey, programId: PublicKey) => PublicKey[];
};

let dlmmSdk: DlmmSdk | null = null;

function loadDlmm(): DlmmSdk {
  if (dlmmSdk) return dlmmSdk;
  // A runtime path keeps Next from turning this into the SDK's ESM build.
  const nodeRequire = createRequire(path.join(process.cwd(), "package.json"));
  const file = path.join(process.cwd(), "src", "lib", "exec", "load-dlmm.cjs");
  const sdk = nodeRequire(file) as DlmmSdk;
  if (typeof sdk?.create !== "function") throw new Error("No se pudo cargar Meteora.");
  dlmmSdk = sdk;
  return sdk;
}

async function poolOf(rpc: Connection, address: string): Promise<DlmmPool> {
  const sdk = await loadDlmm();
  return sdk.create(rpc, new PublicKey(address));
}

function simText(err: unknown, logs: string[] | null | undefined): string {
  const tail = (logs ?? []).filter((line) => /error|failed|insufficient|custom/i.test(line)).slice(-3).join(" ");
  const body = tail || (err instanceof Error ? err.message : JSON.stringify(err));
  return body.slice(0, 280);
}

/** SetComputeUnitPrice is instruction 3 of the compute budget program. */
function hasPriorityFee(tx: Transaction): boolean {
  return tx.instructions.some((ix) => ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === 3);
}

async function landedOn(rpc: Connection, signature: string): Promise<boolean> {
  const status = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const row = status.value[0];
  if (!row || row.err) return false;
  return row.confirmationStatus === "confirmed" || row.confirmationStatus === "finalized";
}

async function commit(rpc: Connection, tx: Transaction, signers: Keypair[], microLamports: number, onSigned: (signature: string) => void): Promise<string> {
  const latest = await rpc.getLatestBlockhash("confirmed");
  if (microLamports > 0 && !hasPriorityFee(tx)) tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  tx.feePayer = signers[0]?.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(...signers);
  const sim = await rpc.simulateTransaction(tx);
  if (sim.value.err) throw new Error(`La simulación rechazó la transacción. ${simText(sim.value.err, sim.value.logs)}`);
  const raw = tx.signature;
  if (!raw) throw new Error("La transacción quedó sin firma.");
  const signature = encodeBase58(raw);
  onSigned(signature);
  await rpc.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
  try {
    const confirmed = await rpc.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
    if (confirmed.value.err) throw new Error("La transacción se confirmó con error.");
  } catch (error) {
    // The RPC can fail the wait while the transaction lands. Ask once before calling it lost.
    if (await landedOn(rpc, signature).catch(() => false)) return signature;
    throw error;
  }
  return signature;
}

function clearAuthority(mint: { mintAuthority: PublicKey | null; freezeAuthority: PublicKey | null }): boolean {
  return mint.mintAuthority == null && mint.freezeAuthority == null;
}

async function tokenRaw(rpc: Connection, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  const found = await rpc.getParsedTokenAccountsByOwner(owner, { mint });
  let total = BigInt(0);
  for (const row of found.value) {
    const data = row.account.data as { parsed?: { info?: { tokenAmount?: { amount?: unknown } } } };
    const amount = data.parsed?.info?.tokenAmount?.amount;
    if (typeof amount === "string" && /^\d+$/.test(amount)) total += BigInt(amount);
  }
  return total;
}

function envNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function liveChain(dir: string, env: Record<string, string | undefined> = process.env): LiveChain {
  const rpc = connection(env);
  const maxImpactBps = Number(env.LIVE_MAX_PRICE_IMPACT_BPS) || 150;
  const slippageBps = Math.min(1_000, Math.max(1, Math.round(Number(env.LIVE_MAX_SLIPPAGE_BPS) || 100)));
  const slippagePct = Math.min(1, slippageBps / 100);
  const microLamports = Math.round(envNumber(env.LIVE_PRIORITY_MICROLAMPORTS, 20_000, 0, 2_000_000));
  const maxBinArrayRent = Math.round(envNumber(env.LIVE_MAX_BIN_ARRAY_RENT_SOL, 0, 0, 1) * 1_000_000_000);
  return {
    balanceLamports: (owner) => rpc.getBalance(new PublicKey(owner), "confirmed"),
    landed: (signature) => landedOn(rpc, signature),
    async existing(positions) {
      const found = new Set<string>();
      for (let i = 0; i < positions.length; i += 100) {
        const chunk = positions.slice(i, i + 100);
        const infos = await rpc.getMultipleAccountsInfo(chunk.map((key) => new PublicKey(key)));
        infos.forEach((info, index) => {
          if (info) found.add(chunk[index]);
        });
      }
      return found;
    },
    async inspect(position) {
      if (!position.position) throw new Error("Esta posición no tiene cuenta en la cadena.");
      const pubkey = new PublicKey(position.position);
      if (!(await rpc.getAccountInfo(pubkey))) return { exists: false, valueLamports: 0, price: 0 };
      const pool = await poolOf(rpc, position.address);
      const solIsY = pool.tokenY.publicKey.toBase58() === WSOL;
      const token = solIsY ? pool.tokenX : pool.tokenY;
      const [held, active] = await Promise.all([pool.getPosition(pubkey), pool.getActiveBin()]);
      const data = held.positionData;
      const price = solPerToken(Number(active.pricePerToken), solIsY);
      return {
        exists: true,
        price,
        valueLamports: positionValue({
          solIsY,
          totalX: Number(data.totalXAmount),
          totalY: Number(data.totalYAmount),
          feeX: Number(data.feeX.toString()),
          feeY: Number(data.feeY.toString()),
          tokenDecimals: token.mint.decimals,
          solPerToken: price,
        }),
      };
    },
    async open(order, onSigned) {
      const wallet = loadKeypair(dir);
      const sdk = loadDlmm();
      const pool = await poolOf(rpc, order.pool);
      const x = pool.tokenX.publicKey.toBase58();
      const y = pool.tokenY.publicKey.toBase58();
      const solIsY = y === WSOL;
      const solIsX = x === WSOL;
      if (solIsY !== order.solIsY || (!solIsY && !solIsX)) throw new Error("El lado del SOL en el pool no coincide.");
      const token = solIsY ? pool.tokenX : pool.tokenY;
      if (token.publicKey.toBase58() !== order.tokenMint) throw new Error("El token del pool no coincide.");
      if (!clearAuthority(token.mint)) throw new Error("El token todavía puede mintear o congelar. No se abre.");
      const active = await pool.getActiveBin();
      const entryPrice = solPerToken(Number(active.pricePerToken), solIsY);
      if (!(entryPrice > 0) || Math.abs(entryPrice / order.price - 1) > MAX_OPEN_PRICE_DRIFT) {
        throw new Error("El precio en la cadena no coincide con el de Meteora. No se abre.");
      }
      const swapForY = solIsY;
      const binsForQuote = await pool.getBinArrayForSwap(swapForY);
      const tokens = order.lamports / 1_000_000_000 / entryPrice;
      const raw = BigInt(Math.max(1, Math.round(tokens * 10 ** token.mint.decimals)));
      const quote = pool.swapQuote(new BN(raw.toString()), swapForY, new BN(slippageBps), binsForQuote);
      const impact = Number(quote.priceImpact.toString());
      if (!(quote.outAmount.gtn(0)) || impactTooHigh(impact, maxImpactBps)) {
        throw new Error("No hay una salida a SOL con un impacto aceptable.");
      }
      const minBinId = solIsY ? active.binId - order.bins : active.binId + 1;
      const maxBinId = solIsY ? active.binId - 1 : active.binId + order.bins;
      if (maxBinId - minBinId + 1 > order.bins) throw new Error("El rango armado no cabe en una posición.");
      // Bin arrays that the range touches and nobody created yet cost rent that never comes back.
      const keys = sdk.getBinArrayKeysCoverage(new BN(minBinId), new BN(maxBinId), pool.pubkey, pool.program.programId);
      const missing = (await rpc.getMultipleAccountsInfo(keys)).filter((info) => info == null).length;
      const rent = missing * BIN_ARRAY_RENT_LAMPORTS;
      if (rent > maxBinArrayRent) {
        throw new Error(`Este rango necesita crear ${missing} bin array(s): ${(rent / 1_000_000_000).toFixed(4)} SOL de renta que no se recupera. No se abre.`);
      }
      const position = Keypair.generate();
      const lamports = new BN(order.lamports);
      const tx = await pool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: position.publicKey,
        user: wallet.publicKey,
        totalXAmount: solIsY ? new BN(0) : lamports,
        totalYAmount: solIsY ? lamports : new BN(0),
        strategy: { minBinId, maxBinId, strategyType: sdk.StrategyType.BidAsk },
        slippage: slippagePct,
      });
      const sent: SentOpen = { signature: "", position: position.publicKey.toBase58(), minBinId, maxBinId, entryPrice };
      sent.signature = await commit(rpc, tx, [wallet, position], microLamports, (signature) => {
        sent.signature = signature;
        onSigned({ ...sent, signature });
      });
      return sent;
    },
    async close(position, onSigned) {
      if (!position.position || position.minBinId == null || position.maxBinId == null) {
        throw new Error("Esta posición no tiene cuenta para cerrarla.");
      }
      const wallet = loadKeypair(dir);
      const pubkey = new PublicKey(position.position);
      const existing = await rpc.getAccountInfo(pubkey);
      if (!existing) return "already-closed";
      const pool = await poolOf(rpc, position.address);
      const txs = await pool.removeLiquidity({
        user: wallet.publicKey,
        position: pubkey,
        fromBinId: position.minBinId,
        toBinId: position.maxBinId,
        bps: new BN(10_000),
        shouldClaimAndClose: true,
      });
      if (txs.length === 0) throw new Error("El cierre no armó ninguna transacción.");
      let signature = "";
      for (const tx of txs) signature = await commit(rpc, tx, [wallet], microLamports, onSigned);
      return signature;
    },
    async sell(target, onSigned) {
      if (!target.tokenMint) return { sold: false, reason: "none" };
      const wallet = loadKeypair(dir);
      const pool = await poolOf(rpc, target.address);
      const solIsY = pool.tokenY.publicKey.toBase58() === WSOL;
      const solIsX = pool.tokenX.publicKey.toBase58() === WSOL;
      if (solIsY !== target.solIsY || (!solIsY && !solIsX)) return { sold: false, reason: "El lado del SOL no coincide. El token se quedó en la wallet." };
      const token = solIsY ? pool.tokenX : pool.tokenY;
      const sol = solIsY ? pool.tokenY : pool.tokenX;
      if (token.publicKey.toBase58() !== target.tokenMint) return { sold: false, reason: "El token del pool no coincide. Se quedó en la wallet." };
      const raw = await tokenRaw(rpc, wallet.publicKey, token.publicKey);
      if (raw <= BigInt(0)) return { sold: false, reason: "none" };
      const swapForY = solIsY;
      const bins = await pool.getBinArrayForSwap(swapForY);
      const quote = pool.swapQuote(new BN(raw.toString()), swapForY, new BN(slippageBps), bins);
      const decision = decideSell({
        rawAmount: raw,
        outLamports: BigInt(quote.outAmount.toString()),
        priceImpactPercent: Number(quote.priceImpact.toString()),
        maxImpactBps,
      });
      if (!decision.sell) return { sold: false, reason: decision.reason };
      const tx = await pool.swap({
        inToken: token.publicKey,
        outToken: sol.publicKey,
        inAmount: new BN(raw.toString()),
        minOutAmount: quote.minOutAmount,
        lbPair: new PublicKey(target.address),
        user: wallet.publicKey,
        binArraysPubkey: quote.binArraysPubkey,
      });
      const signature = await commit(rpc, tx, [wallet], microLamports, onSigned);
      return { sold: true, signature, outLamports: BigInt(quote.outAmount.toString()) };
    },
  };
}
