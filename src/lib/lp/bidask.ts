/**
 * Value of a SOL-only Bid-Ask DLMM position, the shape Decoder Farmer
 * recommends. SOL sits in bins below the entry price, with more SOL in the
 * lower bins (weight grows linearly with distance). When price falls through
 * a bin, that bin's SOL is swapped into the token at the bin's price; when it
 * climbs back, the token is swapped back to SOL.
 *
 * Prices are ratios to the entry price (1 = entry). Fees are not included.
 */

export type BidAskShape = { range: number; binStep: number };

export const DECODER_SHAPE: BidAskShape = { range: 0.75, binStep: 0.01 };

export type Bin = { price: number; weight: number };

export function bidAskBins(shape: BidAskShape): Bin[] {
  const bins: Bin[] = [];
  for (let k = 1; ; k += 1) {
    const price = (1 - shape.binStep) ** k;
    if (price < 1 - shape.range) break;
    bins.push({ price, weight: k });
  }
  const total = bins.reduce((sum, bin) => sum + bin.weight, 0);
  return bins.map((bin) => ({ price: bin.price, weight: bin.weight / total }));
}

/** Position value per 1 SOL deposited, marked at `ratio`, before fees and exit swap costs. */
export function bidAskValue(bins: Bin[], ratio: number): number {
  return bins.reduce((sum, bin) => sum + (bin.price >= ratio ? (bin.weight * ratio) / bin.price : bin.weight), 0);
}

/** Fraction of the deposited SOL that has been swapped into the token at `ratio`. */
export function bidAskDeployed(bins: Bin[], ratio: number): number {
  return bins.filter((bin) => bin.price >= ratio).reduce((sum, bin) => sum + bin.weight, 0);
}

export function lowerEdge(shape: BidAskShape): number {
  return 1 - shape.range;
}
