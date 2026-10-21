/**
 * One pass of the Meteora live bot. Opens at most one position and closes
 * anything already marked. A failure records the error and does not invent a fill.
 * This never throws into the paper loop.
 */

import { randomUUID } from "node:crypto";
import { listPools } from "../lp/datapi";
import { formatLiveDigest, formatLiveNotice, liveDigestDue, sendTelegram, telegramConfig } from "../notify/telegram";
import { decoderFilter } from "../lp/meteora";
import { appendIntent, readIntents, type Intent } from "./intents";
import type { LivePosition } from "./live-book";
import { liveCandidates, planLiveLp, type LiveCandidate, type OpenOrder } from "./lp-plan";
import { liveChain, type LiveChain, type SentOpen } from "./lp-chain";
import { killFile, readLiveFile, readWalletAddress, walletDir, withWallet, writeLiveFile, type LiveFile } from "./wallet";

const STALE_MS = 120_000;

async function notifyLive(env: Record<string, string | undefined>, text: string): Promise<boolean> {
  const config = telegramConfig(env);
  if (!config) return false;
  try {
    await sendTelegram(config, text);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram no respondió";
    console.error("telegram live", message);
    return false;
  }
}

/** One snapshot of the open live positions. Skipped when the bot is off and flat. */
export async function sendLiveDigest(dir: string, env: Record<string, string | undefined>, now: number): Promise<void> {
  const file = await withWallet(() => readLiveFile(dir));
  if (!liveDigestDue(file.digestAt, now)) return;
  if (!file.running && file.positions.length === 0) return;
  if (!telegramConfig(env)) return;
  const sent = await notifyLive(env, formatLiveDigest({ now, positions: file.positions, notice: file.notice }));
  if (!sent) return;
  await withWallet(() => writeLiveFile(dir, { ...readLiveFile(dir), digestAt: now }));
}

function limits(env: Record<string, string | undefined>) {
  const reserve = Number(env.LIVE_MIN_SOL_RESERVE);
  const maxSol = Number(env.LIVE_LP_MAX_SOL);
  return {
    reserveLamports: Math.round((Number.isFinite(reserve) && reserve >= 0 ? reserve : 0.03) * 1_000_000_000),
    maxSol: Number.isFinite(maxSol) && maxSol >= 0 ? maxSol : 0.3,
  };
}

function intentBase(order: OpenOrder, id: string, now: number): Intent {
  return {
    id,
    at: now,
    kind: "open",
    pool: order.pool,
    name: order.name,
    position: null,
    lamports: order.lamports,
    minBinId: null,
    maxBinId: null,
    solIsY: order.solIsY,
    tokenMint: order.tokenMint,
    entryPrice: order.price,
    range: order.range,
    binStepBps: order.binStepBps,
    status: "pending",
  };
}

function positionFrom(order: OpenOrder, sent: SentOpen, now: number): LivePosition {
  return {
    address: order.pool,
    name: order.name,
    stakeSol: order.lamports / 1_000_000_000,
    openedAt: now,
    signature: sent.signature,
    position: sent.position,
    minBinId: sent.minBinId,
    maxBinId: sent.maxBinId,
    solIsY: order.solIsY,
    tokenMint: order.tokenMint,
    entryPrice: order.price,
    lastPrice: order.price,
    range: order.range,
    binStepBps: order.binStepBps,
    closing: false,
    closeReason: null,
    tokenPct: 0,
    positionPct: 0,
    note: "Abierta en la cadena.",
  };
}

async function settlePending(dir: string, chain: LiveChain, file: LiveFile, now: number): Promise<{ file: LiveFile; pending: boolean }> {
  const opens = readIntents(dir).filter((intent) => intent.kind === "open");
  const last = opens.at(-1);
  if (!last || (last.status !== "pending" && last.status !== "sent")) return { file, pending: false };
  if (file.positions.some((position) => position.address === last.pool && position.signature)) {
    return { file, pending: false };
  }
  if (last.signature && last.position && last.minBinId != null && last.maxBinId != null) {
    const landed = await chain.landed(last.signature).catch(() => false);
    if (landed) {
      const adopted = positionFrom(
        {
          pool: last.pool,
          name: last.name,
          solIsY: last.solIsY === true,
          tokenMint: last.tokenMint ?? "",
          lamports: last.lamports,
          bins: last.maxBinId - last.minBinId + 1,
          price: last.entryPrice ?? 0,
          range: last.range ?? 0.75,
          binStepBps: last.binStepBps ?? 0,
        },
        { signature: last.signature, position: last.position, minBinId: last.minBinId, maxBinId: last.maxBinId },
        last.at,
      );
      const next = { ...file, positions: [...file.positions, adopted], notice: `Se confirmó la apertura de ${last.name}.` };
      appendIntent(dir, { ...last, status: "confirmed" });
      return { file: next, pending: false };
    }
  }
  if (now - last.at < STALE_MS) return { file, pending: true };
  appendIntent(dir, { ...last, status: "failed", error: "La apertura no se confirmó." });
  return { file: { ...file, notice: "La apertura anterior no se confirmó. No se abrió otra." }, pending: false };
}

export async function runLiveCycle(
  dir: string,
  chain: LiveChain,
  candidates: () => Promise<LiveCandidate[]>,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): Promise<void> {
  const address = readWalletAddress(dir);
  if (!address) return;
  let file = await withWallet(() => readLiveFile(dir));
  const kill = killFile(dir);
  if (!file.running && !kill && file.positions.length === 0) return;
  const settled = await settlePending(dir, chain, file, now);
  file = await withWallet(() => {
    const fresh = readLiveFile(dir);
    const extra = settled.file.positions.filter((position) => !fresh.positions.some((current) => current.address === position.address));
    const next = { ...fresh, positions: [...fresh.positions, ...extra], notice: extra.length > 0 ? settled.file.notice : fresh.notice };
    if (extra.length > 0) writeLiveFile(dir, next);
    return next;
  });
  let listed: LiveCandidate[] = [];
  let balance = 0;
  if (file.running && !kill && !settled.pending) {
    try {
      [listed, balance] = await Promise.all([candidates(), chain.balanceLamports(address)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo leer el mercado.";
      await withWallet(() => writeLiveFile(dir, { ...readLiveFile(dir), notice: `${message} No se abrió nada.` }));
      return;
    }
  }
  const cap = limits(env);
  const prices: Record<string, number> = {};
  for (const pool of listed) prices[pool.address] = pool.price;
  const plan = planLiveLp({
    running: file.running,
    kill,
    balanceLamports: balance,
    reserveLamports: cap.reserveLamports,
    maxSol: cap.maxSol,
    params: file.params,
    positions: file.positions,
    candidates: listed,
    prices,
    now,
    pendingOpen: settled.pending,
  });
  file = await withWallet(() => {
    const fresh = readLiveFile(dir);
    const positions = plan.positions.flatMap((planned) => {
      const current = fresh.positions.find((position) => position.address === planned.address);
      if (!current) return [];
      return [current.closing ? { ...planned, closing: true, closeReason: current.closeReason, note: current.note || planned.note } : planned];
    });
    const next = { ...fresh, positions, notice: plan.notice };
    writeLiveFile(dir, next);
    return next;
  });
  for (const position of file.positions.filter((item) => item.closing && item.signature)) {
    const id = randomUUID();
    const base: Intent = {
      id,
      at: now,
      kind: "close",
      pool: position.address,
      name: position.name,
      position: position.position,
      lamports: Math.round(position.stakeSol * 1_000_000_000),
      minBinId: position.minBinId,
      maxBinId: position.maxBinId,
      solIsY: position.solIsY,
      tokenMint: position.tokenMint,
      entryPrice: position.entryPrice,
      range: position.range,
      binStepBps: position.binStepBps,
      status: "pending",
    };
    appendIntent(dir, base);
    try {
      const signature = await chain.close(position, (sent) => appendIntent(dir, { ...base, status: "sent", signature: sent }));
      appendIntent(dir, { ...base, status: "confirmed", signature });
      await withWallet(() => {
        const fresh = readLiveFile(dir);
        writeLiveFile(dir, {
          ...fresh,
          positions: fresh.positions.filter((item) => item.address !== position.address),
          notice: `Cerrada ${position.name}.`,
        });
      });
      const realSignature = signature !== "already-closed" ? signature : null;
      await notifyLive(env, formatLiveNotice({ kind: "close", name: position.name, stakeSol: position.stakeSol, signature: realSignature, reason: position.closeReason }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cerrar.";
      appendIntent(dir, { ...base, status: "failed", error: message.slice(0, 280) });
      await withWallet(() => {
        const fresh = readLiveFile(dir);
        writeLiveFile(dir, {
          ...fresh,
          positions: fresh.positions.map((item) => (item.address === position.address ? { ...item, note: message.slice(0, 280) } : item)),
          notice: message.slice(0, 280),
        });
      });
    }
  }
  const order = plan.open;
  if (!order) return;
  const latest = await withWallet(() => readLiveFile(dir));
  if (!latest.running || killFile(dir) || latest.positions.some((position) => position.closing || position.address === order.pool)) return;
  const id = randomUUID();
  const pending = intentBase(order, id, now);
  appendIntent(dir, pending);
  try {
    const sent = await chain.open(order, (opened) => {
      appendIntent(dir, { ...pending, status: "sent", signature: opened.signature, position: opened.position, minBinId: opened.minBinId, maxBinId: opened.maxBinId });
    });
    appendIntent(dir, { ...pending, status: "confirmed", signature: sent.signature, position: sent.position, minBinId: sent.minBinId, maxBinId: sent.maxBinId });
    await withWallet(() => {
      const fresh = readLiveFile(dir);
      const opened = positionFrom(order, sent, now);
      if (!fresh.running || killFile(dir)) {
        opened.closing = true;
        opened.closeReason = "stop";
        opened.note = "Se abrió y el bot ya estaba apagado. Queda para cerrar.";
      }
      writeLiveFile(dir, {
        ...fresh,
        positions: [...fresh.positions.filter((position) => position.address !== opened.address), opened],
        notice: `Abierta ${opened.name} con ${opened.stakeSol.toFixed(4)} SOL.`,
      });
    });
    await notifyLive(env, formatLiveNotice({ kind: "open", name: order.name, stakeSol: order.lamports / 1_000_000_000, signature: sent.signature }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo abrir.";
    appendIntent(dir, { ...pending, status: "failed", error: message.slice(0, 280) });
    await withWallet(() => writeLiveFile(dir, { ...readLiveFile(dir), notice: `${message.slice(0, 240)} No se abrió nada.` }));
  }
}

let pending: Promise<void> | null = null;

/** Fire one live pass. Never overlaps, and never throws into the paper loop. */
export function kickLiveLp(now = Date.now()): void {
  if (pending) return;
  const dir = walletDir();
  pending = runLiveCycle(dir, liveChain(dir), async () => liveCandidates(await listPools(decoderFilter(readLiveFile(dir).params)), now), process.env, now)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Error del bot live";
      console.error("meteora live", message);
    })
    .then(() => sendLiveDigest(dir, process.env, now))
    .finally(() => {
      pending = null;
    });
}
