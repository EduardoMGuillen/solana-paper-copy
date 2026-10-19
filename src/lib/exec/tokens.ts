/**
 * Solana mints for each market. The quote currency is USDC.
 *
 * Decimals are read from chain at runtime (getTokenSupply); the values here
 * are only a fallback. The shadow executor also cross-checks every Jupiter
 * price against Binance, so a wrong mint shows up as "sospechoso" instead
 * of as a fake cost.
 */
export type TokenInfo = { mint: string; decimals: number; note?: string };

export const USDC: TokenInfo = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 };

export const MARKET_TOKENS: Record<string, TokenInfo> = {
  SOL: { mint: "So11111111111111111111111111111111111111112", decimals: 9 },
  JUP: { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6 },
  JTO: { mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", decimals: 9 },
  RAY: { mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", decimals: 6 },
  BONK: { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5 },
  WIF: { mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", decimals: 6 },
  PYTH: { mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", decimals: 6 },
  BTC: { mint: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", decimals: 8, note: "cbBTC (Coinbase Wrapped BTC)" },
  ETH: { mint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", decimals: 8, note: "Wormhole WETH" },
};
