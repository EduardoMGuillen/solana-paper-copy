/**
 * Solana-native tokens with Binance spot history, used by the momentum
 * rotation. All are swappable on Jupiter. Note the survivorship bias: the
 * list only has tokens that are still listed today.
 */
export type UniverseToken = { symbol: string; binance: string };

export const ROTATION_UNIVERSE: UniverseToken[] = [
  "SOL", "JUP", "JTO", "RAY", "BONK", "WIF", "PYTH", "RENDER", "BOME", "PENGU",
  "TRUMP", "TNSR", "ORCA", "W", "PNUT", "ACT", "HNT", "IO", "ME", "KMNO", "LAYER",
].map((symbol) => ({ symbol, binance: `${symbol}USDT` }));
