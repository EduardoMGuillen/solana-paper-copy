import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { METEORA_STARTING_SOL } from "../bot/balances";
import { dataDir } from "../paths";
import { fetchCurrentSnaps, fetchPoolSnap } from "./datapi";
import { DECODER_SHAPE } from "./bidask";
import { METEORA_NEXT_SLOT, METEORA_SLOT, runMeteoraBook, slotStake, type BookSizing, type MeteoraBook } from "./livebook";
import { DECODER_EXITS, DECODER_RULES, passes, type PoolSnap } from "./meteora";

/** Reprice open pools on the bot's cycle. A full screen fills a free 25% slot. */
export const MARK_MS = 12_000;
export const SCAN_MS = 60_000;

type ForwardFile = {
  startedAt: number;
  lastFetchAt: number;
  lastScanAt: number;
  /**
   * First timestamp of the 25% rule. Snaps before this stay one full-size position.
   * Missing on files written before that rule.
   */
  slotFrom?: number;
  /** New positions at or after this time use `slot`. */
  resizeFrom?: number;
  slot?: number;
  /** Pools closed by hand. They are not opened again. */
  manualCloses?: { address: string; name: string; at: number }[];
  error: string | null;
  snaps: PoolSnap[];
};

function bookSizing(state: ForwardFile | null | undefined): BookSizing {
  return {
    slotFrom: state?.slotFrom,
    resizeFrom: state?.resizeFrom,
    slot: state?.slot,
    manualCloses: state?.manualCloses,
  };
}

function activeSlot(state: ForwardFile | null | undefined, now: number): number {
  if (state?.resizeFrom != null && now >= state.resizeFrom) return state.slot ?? METEORA_NEXT_SLOT;
  return METEORA_SLOT;
}

export function dueLiveFetch(
  state: { lastFetchAt: number; lastScanAt: number } | null,
  open: boolean,
  now: number,
  room = false,
): "mark" | "scan" | null {
  if (!state) return "scan";
  const markDue = now - state.lastFetchAt >= MARK_MS;
  const scanDue = now - state.lastScanAt >= SCAN_MS;
  if (open && room) {
    if (scanDue) return "scan";
    return markDue ? "mark" : null;
  }
  if (open) return markDue ? "mark" : null;
  return scanDue ? "scan" : null;
}

export type MeteoraLiveView = MeteoraBook & {
  startedAt: number | null;
  lastFetchAt: number | null;
  snaps: number;
  error: string | null;
  /** SOL deposited in this experiment. Trades never move it. */
  deposit: number;
};

function filePath(): string {
  return path.join(dataDir(), "meteora-forward.json");
}

async function readFileState(): Promise<ForwardFile | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath(), "utf8")) as ForwardFile;
    if (!Array.isArray(parsed.snaps) || !(parsed.startedAt > 0)) return null;
    parsed.lastScanAt ??= parsed.lastFetchAt;
    return parsed;
  } catch {
    return null;
  }
}

async function writeFileState(state: ForwardFile): Promise<void> {
  const file = filePath();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(state));
  await rename(tmp, file);
}

export function toLiveView(state: ForwardFile | null): MeteoraLiveView {
  const book = runMeteoraBook(state?.snaps ?? [], DECODER_RULES, DECODER_SHAPE, DECODER_EXITS, bookSizing(state));
  return {
    ...book,
    startedAt: state?.startedAt ?? null,
    lastFetchAt: state?.lastFetchAt ?? null,
    snaps: state?.snaps.length ?? 0,
    error: state?.error ?? null,
    deposit: METEORA_STARTING_SOL,
  };
}

export async function readMeteoraLive(): Promise<MeteoraLiveView> {
  return toLiveView(await readFileState());
}

function appendFresh(base: ForwardFile, snaps: PoolSnap[], now: number, scanned: boolean): ForwardFile {
  const seen = new Set(base.snaps.map((snap) => `${snap.address}:${snap.t}`));
  const fresh = snaps.filter((snap) => !seen.has(`${snap.address}:${snap.t}`));
  return {
    ...base,
    lastFetchAt: now,
    lastScanAt: scanned ? now : base.lastScanAt,
    error: null,
    snaps: [...base.snaps, ...fresh],
  };
}

/**
 * Mark every open pool on the bot's cycle. Scan about once a minute while a
 * 25% slot is free, including while other positions are open.
 * A network error keeps the previous snaps and records the message.
 */
export async function recordMeteoraForward(now = Date.now()): Promise<void> {
  let previous = await readFileState();
  if (previous && previous.slotFrom == null) {
    previous = { ...previous, slotFrom: now };
    await writeFileState(previous);
  }
  const book = runMeteoraBook(previous?.snaps ?? [], DECODER_RULES, DECODER_SHAPE, DECODER_EXITS, bookSizing(previous));
  const room = slotStake(book.cash, book.equity, activeSlot(previous, now)) != null;
  const due = dueLiveFetch(previous, book.opens.length > 0, now, room);
  if (!due) return;
  const base: ForwardFile = previous ?? {
    startedAt: now,
    lastFetchAt: 0,
    lastScanAt: 0,
    slotFrom: now,
    error: null,
    snaps: [],
  };
  try {
    if (due === "mark" && book.opens.length > 0) {
      const snaps: PoolSnap[] = [];
      for (const pos of book.opens) {
        const snap = await fetchPoolSnap(pos.address, now);
        if (snap) snaps.push(snap);
      }
      await writeFileState(appendFresh(base, snaps, now, false));
      return;
    }
    const listed = await fetchCurrentSnaps(now);
    const watched = new Set(base.snaps.map((snap) => snap.address));
    const snaps = listed.filter((snap) => passes(snap, DECODER_RULES) || watched.has(snap.address));
    for (const pos of book.opens) {
      if (snaps.some((snap) => snap.address === pos.address)) continue;
      const snap = await fetchPoolSnap(pos.address, now);
      if (snap) snaps.push(snap);
    }
    await writeFileState(appendFresh(base, snaps, now, true));
    if (!previous) console.log(`Meteora en papel: experimento propio empezó con ${METEORA_STARTING_SOL} SOL. ${snaps.length} pools en la primera foto.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error de red";
    await writeFileState({ ...base, lastFetchAt: now, error: message });
    console.error("meteora forward", message);
  }
}

let pending: Promise<void> | null = null;

/** Fire one collection if it is due. Never overlaps, and never throws into the trend loop. */
export function kickMeteoraForward(now = Date.now()): void {
  if (pending) return;
  pending = recordMeteoraForward(now).finally(() => {
    pending = null;
  });
}
