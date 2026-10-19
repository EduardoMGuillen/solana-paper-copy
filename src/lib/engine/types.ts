export type Side = "buy" | "sell";

export type RejectReason =
  | "observation"
  | "kill_switch"
  | "leader_paused"
  | "blocklist"
  | "stale_age"
  | "price_drift"
  | "cooldown"
  | "dust"
  | "leader_cap"
  | "no_cash"
  | "no_equity"
  | "no_position"
  | "zero_fraction";

export type RiskSettings = {
  /** Fraction of our equity deployed on each new copy. */
  fraction: number;
  /** Hard cap on that fraction. */
  fractionCap: number;
  /** Minimum SOL notional. Smaller copies are dust. */
  minSol: number;
  maxSignalAgeMs: number;
  maxPriceDriftBps: number;
  leaderCapitalCapSol: number;
  /** Pause new copies when leader drawdown reaches this fraction. */
  leaderDrawdownPause: number;
  mintCooldownMs: number;
  blocklist: string[];
  /** Realized loss today, in account dollars, that trips the kill switch. */
  dailyLossKillSol: number;
  protectiveStopPct: number;
  feeBps: number;
  slippageBps: number;
};

export type LeaderFill = {
  leaderId: string;
  mint: string;
  symbol: string;
  side: Side;
  leaderQtyBefore: number;
  leaderQtyAfter: number;
  fillPriceSol: number;
  fillTime: number;
  observedAt: number;
  currentPriceSol: number;
  /** Ignored by the sizer. Present so tests can prove we do not copy it. */
  leaderNotionalSol: number;
  signature?: string;
};

export type CopyDecision =
  | { ok: true; action: "buy"; sizeSol: number; shrink: number }
  | {
      ok: true;
      action: "sell";
      sellFraction: number;
      qty: number;
      notionalSol: number;
    }
  | { ok: false; action: "skip"; reasons: RejectReason[] };

export type LeaderStats = {
  wins: number;
  losses: number;
  closed: number;
  grossProfitSol: number;
  grossLossSol: number;
  maxDrawdown: number;
};

export type LeaderBookPosition = {
  qty: number;
  costSol: number;
};

export type Personality = "consistent" | "choppy" | "drawdown";

export type Leader = {
  id: string;
  name: string;
  kind: "demo" | "wallet" | "meteora";
  personality?: Personality;
  wallet?: string;
  enabled: boolean;
  /** False when a Meteora wallet has fallen out of the current top 7. */
  listed: boolean;
  rank: number | null;
  /** Stake2Earn active stake, not a PnL figure. */
  publishedStake: number | null;
  /** Indexed accumulated reward in USD. Not a 7-day trading PnL. */
  publishedRewardUsd: number | null;
  note: string;
  /** Virtual bankroll used only for the leader's own stats and drawdown. */
  cashSol: number;
  peakEquity: number;
  equity: number;
  holdTicks: number;
  stats: LeaderStats;
  book: Record<string, LeaderBookPosition>;
  rpcError: string | null;
  lastPollAt: number | null;
  seenSignatures: string[];
};

export type SeriesPoint = { t: number; pnl: number; drawdown: number };

export type MeteoraWallet = {
  rank: number;
  address: string;
  stakedAmount: number;
  rewardUsd: number;
};

export type MeteoraFeed = {
  status: "idle" | "ok" | "unavailable";
  sourceName: string;
  ranksWhat: string;
  windowLabel: string;
  vaultLabel: string | null;
  vaultAddress: string | null;
  refreshedAt: number | null;
  attemptedAt: number | null;
  error: string | null;
  wallets: MeteoraWallet[];
};

export type Position = {
  id: string;
  leaderId: string;
  mint: string;
  symbol: string;
  qty: number;
  costSol: number;
  entryPrice: number;
  openedAt: number;
  stopPrice: number;
};

export type TradeReason = "entrada" | "salida" | "stop" | "cierre" | "apagado";

export type Trade = {
  id: string;
  leaderId: string;
  mint: string;
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  notionalSol: number;
  feeSol: number;
  /** Dollar slippage versus the mark, already inside the fill price. */
  slippage: number;
  /** Average entry of the copy. Present on both buys and sells. */
  entry: number | null;
  /** Fill price after slippage. Null until the copy is sold. */
  exit: number | null;
  pnlSol: number | null;
  reason: TradeReason;
  ts: number;
  openedAt: number | null;
  closedAt: number | null;
};

export type Skip = {
  id: string;
  leaderId: string;
  mint: string;
  symbol: string;
  side: Side;
  reasons: RejectReason[];
  ts: number;
};

export type EquityPoint = { t: number; equity: number };
export type DrawdownPoint = { t: number; drawdown: number };

export type EngineState = {
  version: 2;
  seq: number;
  cashSol: number;
  startingEquity: number;
  settings: RiskSettings;
  leaders: Leader[];
  positions: Position[];
  trades: Trade[];
  skips: Skip[];
  equityCurve: EquityPoint[];
  drawdownCurve: DrawdownPoint[];
  /** Our paper PnL and the leader's own drawdown, one series per leader id. */
  series: Record<string, SeriesPoint[]>;
  accountPeak: number;
  prices: Record<string, number>;
  mintLastEntry: Record<string, number>;
  kill: {
    manual: boolean;
    auto: boolean;
    reason: string | null;
    dayKey: string;
    realizedToday: number;
  };
  meteora: MeteoraFeed;
  rpcCursor: number;
  demoTick: number;
  createdAt: number;
  updatedAt: number;
};

export const REASON_LABEL: Record<RejectReason, string> = {
  observation: "Líder en observación",
  kill_switch: "Interruptor de pérdidas activo",
  leader_paused: "Líder pausado por drawdown",
  blocklist: "Mint en la lista de bloqueo",
  stale_age: "Señal demasiado vieja",
  price_drift: "El precio se alejó del fill",
  cooldown: "Enfriamiento del token",
  dust: "Por debajo del mínimo en SOL",
  leader_cap: "Tope de capital del líder",
  no_cash: "Efectivo insuficiente",
  no_equity: "Patrimonio insuficiente",
  no_position: "No hay copia abierta",
  zero_fraction: "El líder no redujo la posición",
};

export const TRADE_LABEL: Record<TradeReason, string> = {
  entrada: "Entrada copiada",
  salida: "Salida proporcional",
  stop: "Stop de protección",
  cierre: "Cierre al quitar líder",
  apagado: "Cierre al detener la mesa",
};

export const REASON_ORDER: RejectReason[] = [
  "observation",
  "kill_switch",
  "leader_paused",
  "blocklist",
  "stale_age",
  "price_drift",
  "cooldown",
  "no_position",
  "zero_fraction",
  "leader_cap",
  "no_cash",
  "no_equity",
  "dust",
];
