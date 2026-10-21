/**
 * Open positions of the Meteora live bot.
 * Stop closes every one. A manual close removes only the chosen pool.
 * A position without a chain signature is only a record and can be dropped.
 * One with a signature stays "closing" until the chain close is confirmed.
 */

export type LiveCloseReason = "stop" | "manual" | "take-profit" | "loss" | "time" | "rug";

const CLOSE_REASONS = new Set<LiveCloseReason>(["stop", "manual", "take-profit", "loss", "time", "rug"]);

export type LivePosition = {
  address: string;
  name: string;
  stakeSol: number;
  openedAt: number;
  signature: string | null;
  /** Position account. The pool address is `address`. */
  position: string | null;
  minBinId: number | null;
  maxBinId: number | null;
  solIsY: boolean;
  tokenMint: string | null;
  entryPrice: number | null;
  lastPrice: number | null;
  range: number | null;
  binStepBps: number | null;
  closing: boolean;
  closeReason: LiveCloseReason | null;
  tokenPct: number | null;
  positionPct: number | null;
  note: string;
};

export function parseLivePosition(raw: unknown): LivePosition | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.address !== "string" || row.address.length < 32) return null;
  if (typeof row.name !== "string" || !row.name) return null;
  const stake = typeof row.stakeSol === "number" ? row.stakeSol : Number.NaN;
  const openedAt = typeof row.openedAt === "number" ? row.openedAt : Number.NaN;
  if (!(stake > 0) || !(openedAt > 0)) return null;
  const closing = row.closing === true;
  const closeReason = typeof row.closeReason === "string" && CLOSE_REASONS.has(row.closeReason as LiveCloseReason) ? (row.closeReason as LiveCloseReason) : null;
  const bin = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) ? value : null);
  return {
    address: row.address,
    name: row.name,
    stakeSol: stake,
    openedAt,
    signature: typeof row.signature === "string" ? row.signature : null,
    position: typeof row.position === "string" ? row.position : null,
    minBinId: bin(row.minBinId),
    maxBinId: bin(row.maxBinId),
    solIsY: row.solIsY !== false,
    tokenMint: typeof row.tokenMint === "string" ? row.tokenMint : null,
    entryPrice: typeof row.entryPrice === "number" && row.entryPrice > 0 ? row.entryPrice : null,
    lastPrice: typeof row.lastPrice === "number" && row.lastPrice > 0 ? row.lastPrice : null,
    range: typeof row.range === "number" && row.range > 0 ? row.range : null,
    binStepBps: typeof row.binStepBps === "number" && row.binStepBps > 0 ? row.binStepBps : null,
    closing,
    closeReason: closing ? closeReason : null,
    tokenPct: typeof row.tokenPct === "number" ? row.tokenPct : null,
    positionPct: typeof row.positionPct === "number" ? row.positionPct : null,
    note: typeof row.note === "string" ? row.note : "",
  };
}

function mark(position: LivePosition, reason: LiveCloseReason): LivePosition | null {
  if (!position.signature) return null;
  return {
    ...position,
    closing: true,
    closeReason: reason,
    note: reason === "stop" ? "Stop está cerrando esta posición." : "Cierre manual en curso.",
  };
}

/** Drop unsigned rows. Signed rows stay visible until the chain close confirms. */
export function closeAllPositions(positions: LivePosition[]): LivePosition[] {
  return positions.flatMap((position) => {
    const next = mark(position, "stop");
    return next ? [next] : [];
  });
}

export function closeOnePosition(positions: LivePosition[], address: string): { positions: LivePosition[]; found: boolean } {
  let found = false;
  const next = positions.flatMap((position) => {
    if (position.address !== address) return [position];
    found = true;
    const marked = mark(position, "manual");
    return marked ? [marked] : [];
  });
  return { positions: next, found };
}
