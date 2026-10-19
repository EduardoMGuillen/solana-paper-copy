/**
 * Leader sells (qtyBefore - qtyAfter) / qtyBefore of their position.
 * The caller applies that same fraction to our copy.
 */
export function proportionalSellFraction(
  qtyBefore: number,
  qtyAfter: number,
): number {
  if (!(qtyBefore > 0)) return 0;
  const sold = qtyBefore - qtyAfter;
  if (sold <= 0) return 0;
  return Math.min(1, sold / qtyBefore);
}

export function stopTriggered(
  entryPrice: number,
  mark: number,
  stopPct: number,
): boolean {
  if (!(entryPrice > 0)) return false;
  return mark <= entryPrice * (1 - stopPct);
}
