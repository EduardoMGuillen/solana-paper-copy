/**
 * One pass of the Meteora live bot. Opens at most one position and closes
 * anything already marked. A failure records the error and does not invent a fill.
 * Exits are decided on the position's on-chain value, never on a model.
 * This never throws into the paper loop.
 */

import { randomUUID } from "node:crypto";
import { listPools } from "../lp/datapi";
import { formatLiveDigest, formatLiveNotice, formatLiveSell, liveDigestDue, sendTelegram, telegramConfig } from "../notify/telegram";
import { decoderFilter } from "../lp/meteora";
import { appendIntent, readIntents, type Intent } from "./intents";
import type { LivePosition } from "./live-book";
import { liveCandidates, planLiveLp, SKIP_POOL_MS, type LiveCandidate, type OpenOrder, type PositionMark } from "./lp-plan";
import { liveChain, type LiveChain, type SellResult, type SellTarget, type SentOpen } from "./lp-chain";
import { DUST_SELL_REASON } from "./sell-rule";
import { killFile, readLiveFile, readWalletAddress, walletDir, withWallet, writeLiveFile, type Leftover, type LiveFile } from "./wallet";

const STALE_MS = 120_000;
/** A token that could not be sold is quoted again this often. */
const LEFTOVER_RETRY_MS = 5 * 60_000;
/** Open intents older than this are not checked against the chain any more. */
const RECONCILE_WINDOW_MS = 7 * 86_400_000;

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

async function setNotice(dir: string, text: string): Promise<void> {
  await withWallet(() => writeLiveFile(dir, { ...readLiveFile(dir), notice: text.slice(0, 280) }));
}

function sellIntent(target: SellTarget, now: number): Intent {
  return {
    id: randomUUID(),
    at: now,
    kind: "sell",
    pool: target.address,
    name: target.name,
    position: null,
    lamports: 0,
    minBinId: null,
    maxBinId: null,
    solIsY: target.solIsY,
    tokenMint: target.tokenMint,
    entryPrice: null,
    range: null,
    binStepBps: null,
    status: "pending",
  };
}

/**
 * Swap a leftover token back to SOL. True when there is nothing more to do:
 * sold, nothing left, or too little to pay for the swap.
 * `loud` reports a failure on Telegram; retries report only a sale.
 */
async function sellLeftover(dir: string, chain: LiveChain, target: SellTarget, env: Record<string, string | undefined>, now: number, loud: boolean): Promise<boolean> {
  const base = sellIntent(target, now);
  try {
    appendIntent(dir, base);
    const result: SellResult = await chain.sell(target, (signature) => appendIntent(dir, { ...base, status: "sent", signature }));
    if (result.sold) {
      const outSol = Number(result.outLamports) / 1_000_000_000;
      appendIntent(dir, { ...base, status: "confirmed", signature: result.signature, lamports: Number(result.outLamports) });
      await setNotice(dir, `${target.name}: token vendido por ${outSol.toFixed(4)} SOL.`);
      await notifyLive(env, formatLiveSell({ name: target.name, outSol, signature: result.signature, note: null }));
      return true;
    }
    if (result.reason === "none") {
      appendIntent(dir, { ...base, status: "confirmed" });
      return true;
    }
    appendIntent(dir, { ...base, status: "failed", error: result.reason.slice(0, 280) });
    const done = result.reason === DUST_SELL_REASON;
    if (loud) {
      const retry = done ? "" : " Se reintenta cada 5 min.";
      await setNotice(dir, `Cerrada ${target.name}. ${result.reason}${retry}`);
      await notifyLive(env, formatLiveSell({ name: target.name, outSol: null, signature: null, note: `${result.reason}${retry}` }));
    }
    return done;
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo vender el token.";
    appendIntent(dir, { ...base, status: "failed", error: message.slice(0, 280) });
    if (loud) {
      await setNotice(dir, `Cerrada ${target.name}. ${message} El token se quedó en la wallet. Se reintenta cada 5 min.`);
      await notifyLive(env, formatLiveSell({ name: target.name, outSol: null, signature: null, note: `${message} Se reintenta cada 5 min.` }));
    }
    return false;
  }
}

function addLeftover(list: Leftover[], position: LivePosition, now: number): Leftover[] {
  if (!position.tokenMint || list.some((item) => item.tokenMint === position.tokenMint)) return list;
  return [...list, { pool: position.address, name: position.name, tokenMint: position.tokenMint, solIsY: position.solIsY, since: now, triedAt: now }];
}

async function retryLeftovers(dir: string, chain: LiveChain, env: Record<string, string | undefined>, now: number): Promise<void> {
  const file = await withWallet(() => readLiveFile(dir));
  for (const item of file.leftovers.filter((row) => now - row.triedAt >= LEFTOVER_RETRY_MS)) {
    const done = await sellLeftover(dir, chain, { address: item.pool, name: item.name, tokenMint: item.tokenMint, solIsY: item.solIsY }, env, now, false);
    await withWallet(() => {
      const fresh = readLiveFile(dir);
      const leftovers = done
        ? fresh.leftovers.filter((row) => row.tokenMint !== item.tokenMint)
        : fresh.leftovers.map((row) => (row.tokenMint === item.tokenMint ? { ...row, triedAt: now } : row));
      writeLiveFile(dir, { ...fresh, leftovers });
    });
  }
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
  const entry = sent.entryPrice > 0 ? sent.entryPrice : order.price;
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
    entryPrice: entry,
    lastPrice: entry,
    range: order.range,
    binStepBps: order.binStepBps,
    closing: false,
    closeReason: null,
    tokenPct: 0,
    positionPct: 0,
    note: "Abierta en la cadena.",
  };
}

function positionFromIntent(intent: Intent): LivePosition | null {
  if (!intent.signature || !intent.position || intent.minBinId == null || intent.maxBinId == null) return null;
  return positionFrom(
    {
      pool: intent.pool,
      name: intent.name,
      solIsY: intent.solIsY === true,
      tokenMint: intent.tokenMint ?? "",
      lamports: intent.lamports,
      bins: intent.maxBinId - intent.minBinId + 1,
      price: intent.entryPrice ?? 0,
      range: intent.range ?? 0.75,
      binStepBps: intent.binStepBps ?? 0,
    },
    { signature: intent.signature, position: intent.position, minBinId: intent.minBinId, maxBinId: intent.maxBinId, entryPrice: intent.entryPrice ?? 0 },
    intent.at,
  );
}

/** Journal and send one close. Returns the signature, or "already-closed". */
async function closeOnChain(dir: string, chain: LiveChain, position: LivePosition, now: number): Promise<string> {
  const base: Intent = {
    id: randomUUID(),
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
    return signature;
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cerrar.";
    appendIntent(dir, { ...base, status: "failed", error: message.slice(0, 280) });
    throw error;
  }
}

/**
 * Positions the journal signed that are on chain but not in the book, for
 * example when the confirm failed while the transaction landed. They are
 * adopted, or closed when the book already holds that pool.
 */
async function reconcile(dir: string, chain: LiveChain, env: Record<string, string | undefined>, now: number): Promise<void> {
  const intents = readIntents(dir);
  const closed = new Set(intents.filter((intent) => intent.kind === "close" && intent.status === "confirmed" && intent.position).map((intent) => intent.position as string));
  const signed = new Map<string, Intent>();
  for (const intent of intents) {
    if (intent.kind !== "open" || !intent.position || !intent.signature || now - intent.at > RECONCILE_WINDOW_MS) continue;
    signed.set(intent.position, intent);
  }
  const book = await withWallet(() => readLiveFile(dir));
  const known = new Set(book.positions.map((position) => position.position).filter((key): key is string => Boolean(key)));
  const unknown = [...signed.keys()].filter((key) => !known.has(key) && !closed.has(key));
  if (unknown.length === 0) return;
  const found = await chain.existing(unknown);
  for (const key of unknown) {
    if (!found.has(key)) continue;
    const adopted = positionFromIntent(signed.get(key) as Intent);
    if (!adopted) continue;
    const taken = await withWallet(() => readLiveFile(dir).positions.some((position) => position.address === adopted.address));
    if (taken) {
      // The book tracks one position per pool. A second one is closed instead of tracked.
      try {
        await closeOnChain(dir, chain, adopted, now);
        await notifyLive(env, formatLiveNotice({ kind: "close", name: adopted.name, stakeSol: adopted.stakeSol, signature: null, reason: "duplicada" }));
      } catch {
        // Retried on the next pass: the account still exists and is still unknown.
      }
      continue;
    }
    await withWallet(() => {
      const fresh = readLiveFile(dir);
      writeLiveFile(dir, {
        ...fresh,
        positions: [...fresh.positions, { ...adopted, note: "Recuperada de la cadena." }],
        notice: `Se encontró en la cadena la posición de ${adopted.name}. Ya se sigue.`,
      });
    });
    await notifyLive(env, formatLiveNotice({ kind: "open", name: adopted.name, stakeSol: adopted.stakeSol, signature: adopted.signature }));
  }
}

/** True while the last open is signed or pending and still young enough to land. */
async function settlePending(dir: string, chain: LiveChain, file: LiveFile, now: number): Promise<{ notice: string | null; pending: boolean }> {
  const opens = readIntents(dir).filter((intent) => intent.kind === "open");
  const last = opens.at(-1);
  if (!last || (last.status !== "pending" && last.status !== "sent")) return { notice: null, pending: false };
  if (file.positions.some((position) => position.address === last.pool && position.signature)) return { notice: null, pending: false };
  if (last.signature && (await chain.landed(last.signature).catch(() => false))) {
    // It landed: reconcile adopts it on the next pass from the account itself.
    return { notice: null, pending: true };
  }
  if (now - last.at < STALE_MS) return { notice: null, pending: true };
  appendIntent(dir, { ...last, status: "failed", error: "La apertura no se confirmó." });
  return { notice: "La apertura anterior no se confirmó. No se abrió otra.", pending: false };
}

async function readMarks(chain: LiveChain, positions: LivePosition[]): Promise<Record<string, PositionMark | undefined>> {
  const marks: Record<string, PositionMark | undefined> = {};
  for (const position of positions) {
    if (position.closing || !position.signature) continue;
    try {
      marks[position.address] = await chain.inspect(position);
    } catch (error) {
      console.error("meteora live inspect", error instanceof Error ? error.message : error);
    }
  }
  return marks;
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
  if (!file.running && !kill && file.positions.length === 0 && file.leftovers.length === 0) return;
  try {
    await reconcile(dir, chain, env, now);
  } catch (error) {
    console.error("meteora live reconcile", error instanceof Error ? error.message : error);
  }
  file = await withWallet(() => readLiveFile(dir));
  const settled = await settlePending(dir, chain, file, now);
  let listed: LiveCandidate[] = [];
  let balance = 0;
  let marketError: string | null = null;
  if (file.running && !kill && !settled.pending) {
    try {
      [listed, balance] = await Promise.all([candidates(), chain.balanceLamports(address)]);
    } catch (error) {
      // Without a market nothing opens, but open positions are still marked and closed.
      marketError = `${error instanceof Error ? error.message : "No se pudo leer el mercado."} No se abrió nada.`;
    }
  }
  const marks = await readMarks(chain, file.positions);
  const cap = limits(env);
  const plan = planLiveLp({
    running: file.running && marketError == null,
    kill,
    balanceLamports: balance,
    reserveLamports: cap.reserveLamports,
    maxSol: cap.maxSol,
    params: file.params,
    positions: file.positions,
    candidates: listed,
    marks,
    skipped: file.skipped,
    now,
    pendingOpen: settled.pending,
  });
  file = await withWallet(() => {
    const fresh = readLiveFile(dir);
    const positions = fresh.positions.map((current) => {
      const planned = plan.positions.find((position) => position.address === current.address);
      if (!planned) return current;
      return current.closing ? { ...planned, closing: true, closeReason: current.closeReason, note: current.note || planned.note } : planned;
    });
    const skipped = Object.fromEntries(Object.entries(fresh.skipped).filter(([, until]) => until > now));
    const next = { ...fresh, positions, skipped, notice: marketError ?? settled.notice ?? plan.notice };
    writeLiveFile(dir, next);
    return next;
  });
  for (const position of file.positions.filter((item) => item.closing && item.signature)) {
    try {
      const signature = await closeOnChain(dir, chain, position, now);
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
      const done = await sellLeftover(dir, chain, position, env, now, true);
      if (!done) {
        await withWallet(() => {
          const fresh = readLiveFile(dir);
          writeLiveFile(dir, { ...fresh, leftovers: addLeftover(fresh.leftovers, position, now) });
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cerrar.";
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
  await retryLeftovers(dir, chain, env, now);
  const order = plan.open;
  if (!order) return;
  const latest = await withWallet(() => readLiveFile(dir));
  if (!latest.running || killFile(dir) || latest.positions.some((position) => position.closing || position.address === order.pool)) return;
  const id = randomUUID();
  const pending = intentBase(order, id, now);
  appendIntent(dir, pending);
  let signed = false;
  try {
    const sent = await chain.open(order, (opened) => {
      signed = true;
      appendIntent(dir, {
        ...pending,
        status: "sent",
        signature: opened.signature,
        position: opened.position,
        minBinId: opened.minBinId,
        maxBinId: opened.maxBinId,
        entryPrice: opened.entryPrice > 0 ? opened.entryPrice : pending.entryPrice,
      });
    });
    appendIntent(dir, {
      ...pending,
      status: "confirmed",
      signature: sent.signature,
      position: sent.position,
      minBinId: sent.minBinId,
      maxBinId: sent.maxBinId,
      entryPrice: sent.entryPrice > 0 ? sent.entryPrice : pending.entryPrice,
    });
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
    if (signed) {
      // Signed and maybe broadcast: the chain decides. settlePending and reconcile pick it up.
      await setNotice(dir, `${message.slice(0, 160)} La apertura de ${order.name} se firmó; se revisa en la cadena.`);
      return;
    }
    appendIntent(dir, { ...pending, status: "failed", error: message.slice(0, 280) });
    await withWallet(() => {
      const fresh = readLiveFile(dir);
      writeLiveFile(dir, {
        ...fresh,
        skipped: { ...fresh.skipped, [order.pool]: now + SKIP_POOL_MS },
        notice: `${message.slice(0, 200)} No se abrió nada. ${order.name} queda en pausa 6 h.`,
      });
    });
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
