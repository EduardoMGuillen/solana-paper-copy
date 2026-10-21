/**
 * The only module that opens wallet.json. It signs Meteora liquidity
 * transactions for the dedicated wallet and nothing else.
 */

import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { DEFAULT_RPC, readWalletAddress } from "./wallet";
import { WSOL } from "../lp/meteora";
import type { LivePosition } from "./live-book";
import type { OpenOrder } from "./lp-plan";

export type SentOpen = { signature: string; position: string; minBinId: number; maxBinId: number };

export type LiveChain = {
  balanceLamports(owner: string): Promise<number>;
  landed(signature: string): Promise<boolean>;
  open(order: OpenOrder, onSent: (sent: SentOpen) => void): Promise<SentOpen>;
  close(position: LivePosition, onSent: (signature: string) => void): Promise<string>;
};

type DlmmPool = {
  tokenX: { publicKey: PublicKey; mint: { mintAuthority: PublicKey | null; freezeAuthority: PublicKey | null; decimals: number } };
  tokenY: { publicKey: PublicKey; mint: { mintAuthority: PublicKey | null; freezeAuthority: PublicKey | null; decimals: number } };
  getActiveBin(): Promise<{ binId: number }>;
  getBinArrayForSwap(swapForY: boolean): Promise<unknown[]>;
  swapQuote(inAmount: BN, swapForY: boolean, allowedSlippage: BN, binArrays: unknown[]): { outAmount: BN; priceImpact: { toString(): string } };
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

async function poolOf(rpc: Connection, address: string): Promise<DlmmPool> {
  const { default: DLMM } = await import("@meteora-ag/dlmm");
  return DLMM.create(rpc, new PublicKey(address)) as Promise<DlmmPool>;
}

function simText(err: unknown, logs: string[] | null | undefined): string {
  const tail = (logs ?? []).filter((line) => /error|failed|insufficient|custom/i.test(line)).slice(-3).join(" ");
  const body = tail || (err instanceof Error ? err.message : JSON.stringify(err));
  return body.slice(0, 280);
}

async function commit(rpc: Connection, tx: Transaction, signers: Keypair[], onSent: (signature: string) => void): Promise<string> {
  const latest = await rpc.getLatestBlockhash("confirmed");
  tx.feePayer = signers[0]?.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(...signers);
  const sim = await rpc.simulateTransaction(tx);
  if (sim.value.err) throw new Error(`La simulación rechazó la transacción. ${simText(sim.value.err, sim.value.logs)}`);
  const signature = await rpc.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
  onSent(signature);
  const confirmed = await rpc.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
  if (confirmed.value.err) throw new Error("La transacción se confirmó con error.");
  return signature;
}

function clearAuthority(mint: { mintAuthority: PublicKey | null; freezeAuthority: PublicKey | null }): boolean {
  return mint.mintAuthority == null && mint.freezeAuthority == null;
}

export function liveChain(dir: string, env: Record<string, string | undefined> = process.env): LiveChain {
  const rpc = connection(env);
  const maxImpact = (Number(env.LIVE_MAX_PRICE_IMPACT_BPS) || 150) / 10_000;
  const slippagePct = Math.min(1, (Number(env.LIVE_MAX_SLIPPAGE_BPS) || 100) / 100);
  return {
    balanceLamports: (owner) => rpc.getBalance(new PublicKey(owner), "confirmed"),
    async landed(signature) {
      const status = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const row = status.value[0];
      if (!row || row.err) return false;
      return row.confirmationStatus === "confirmed" || row.confirmationStatus === "finalized";
    },
    async open(order, onSent) {
      const wallet = loadKeypair(dir);
      const pool = await poolOf(rpc, order.pool);
      const x = pool.tokenX.publicKey.toBase58();
      const y = pool.tokenY.publicKey.toBase58();
      const solIsY = y === WSOL;
      const solIsX = x === WSOL;
      if (solIsY !== order.solIsY || (!solIsY && !solIsX)) throw new Error("El lado del SOL en el pool no coincide.");
      const token = solIsY ? pool.tokenX : pool.tokenY;
      if (token.publicKey.toBase58() !== order.tokenMint) throw new Error("El token del pool no coincide.");
      if (!clearAuthority(token.mint)) throw new Error("El token todavía puede mintear o congelar. No se abre.");
      const swapForY = solIsY;
      const binsForQuote = await pool.getBinArrayForSwap(swapForY);
      const tokens = order.lamports / 1_000_000_000 / order.price;
      const raw = BigInt(Math.max(1, Math.round(tokens * 10 ** token.mint.decimals)));
      const quote = pool.swapQuote(new BN(raw.toString()), swapForY, new BN(100), binsForQuote);
      const impact = Number(quote.priceImpact.toString());
      if (!(quote.outAmount.gtn(0)) || !Number.isFinite(impact) || impact > maxImpact) {
        throw new Error("No hay una salida a SOL con un impacto aceptable.");
      }
      const active = await pool.getActiveBin();
      const minBinId = solIsY ? active.binId - order.bins : active.binId + 1;
      const maxBinId = solIsY ? active.binId - 1 : active.binId + order.bins;
      if (maxBinId - minBinId + 1 > order.bins) throw new Error("El rango armado no cabe en una posición.");
      const position = Keypair.generate();
      const lamports = new BN(order.lamports);
      const tx = await pool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: position.publicKey,
        user: wallet.publicKey,
        totalXAmount: solIsY ? new BN(0) : lamports,
        totalYAmount: solIsY ? lamports : new BN(0),
        strategy: { minBinId, maxBinId, strategyType: (await import("@meteora-ag/dlmm")).StrategyType.BidAsk },
        slippage: slippagePct,
      });
      const sent: SentOpen = { signature: "", position: position.publicKey.toBase58(), minBinId, maxBinId };
      sent.signature = await commit(rpc, tx, [wallet, position], (signature) => {
        sent.signature = signature;
        onSent({ ...sent, signature });
      });
      return sent;
    },
    async close(position, onSent) {
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
      for (const tx of txs) signature = await commit(rpc, tx, [wallet], onSent);
      return signature;
    },
  };
}
