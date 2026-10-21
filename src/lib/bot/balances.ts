/** Meteora is its own paper experiment. It never debits the trend-trading account. */
export const METEORA_STARTING_SOL = 1;

export type SolSnapshot = {
  startingSol: number;
  equitySol: number | null;
  closed: number;
  open: number;
};

/**
 * SOL shown for the trend experiment.
 * With no paper trades the deposit stays put. Dividing the frozen dollar cash
 * by a newer SOL price makes an idle account look smaller.
 */
export function tradesBalanceSol(account: SolSnapshot): number {
  if (account.closed === 0 && account.open === 0) return account.startingSol;
  return account.equitySol ?? account.startingSol;
}
