import type { EffectivenessDataset } from "../effectiveness";
import { copyPnl } from "./engine";
import { drawdownPct, exitProceeds, profitFactor, winRate } from "./money";
import { REASON_LABEL, TRADE_LABEL, type EngineState, type Leader } from "./types";

function usd(value: number): string {
  return value.toLocaleString("es-ES", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export type DeskView = ReturnType<typeof toView>;

function statusOf(leader: Leader, state: EngineState): { code: string; label: string } {
  if (!leader.enabled) return { code: "observation", label: "Observación" };
  const drawdown = drawdownPct(leader.peakEquity, leader.equity);
  if (drawdown >= state.settings.leaderDrawdownPause) {
    return { code: "paused", label: "Pausado" };
  }
  if (state.kill.manual || state.kill.auto) {
    return { code: "halted", label: "Sin copias nuevas" };
  }
  return { code: "copying", label: "Copiando" };
}

function trend(first: number, last: number): string {
  if (last > first * 1.002) return "Tendencia al alza.";
  if (last < first * 0.998) return "Tendencia a la baja.";
  return "Casi plana.";
}

export function toView(state: EngineState, saved: EffectivenessDataset) {
  const equity = saved.equity;
  const realized = state.trades.reduce((sum, trade) => sum + (trade.pnlSol ?? 0), 0);
  const unrealizedPnl = state.leaders.reduce(
    (sum, leader) => sum + copyPnl(state, leader.id).unrealized,
    0,
  );
  const curve = saved.equityCurve.length > 0 ? saved.equityCurve : state.equityCurve;
  const drawdown = saved.drawdownCurve.length > 0 ? saved.drawdownCurve : state.drawdownCurve;
  const firstEquity = curve[0]?.equity ?? saved.startingEquity;
  const lastEquity = curve[curve.length - 1]?.equity ?? equity;
  const maxDrawdown = saved.maxDrawdown;

  const leaders = state.leaders.map((leader) => {
    const pnl = copyPnl(state, leader.id);
    const series = state.series[leader.id] ?? [];
    const factor = profitFactor(leader.stats);
    return {
      id: leader.id,
      name: leader.name,
      kind: leader.kind,
      wallet: leader.wallet ?? null,
      enabled: leader.enabled,
      listed: leader.listed,
      rank: leader.rank,
      publishedStake: leader.publishedStake,
      publishedRewardUsd: leader.publishedRewardUsd,
      note: leader.note,
      status: statusOf(leader, state),
      drawdown: drawdownPct(leader.peakEquity, leader.equity),
      winRate: winRate(leader.stats),
      profitFactor: factor,
      maxDrawdown: leader.stats.maxDrawdown,
      closed: leader.stats.closed,
      copiedPnl: pnl.total,
      rpcError: leader.rpcError,
      series: series.slice(-80),
    };
  });

  return {
    now: state.updatedAt,
    disclaimer: "Los resultados en papel no son beneficios reales. Esta mesa no firma ni envía transacciones.",
    account: {
      equity,
      cash: state.cashSol,
      startingEquity: saved.startingEquity,
      realized,
      unrealized: unrealizedPnl,
      dayPnl: state.kill.realizedToday,
      maxDrawdown,
      equitySummary: `Patrimonio de ${usd(firstEquity)} a ${usd(lastEquity)} en ${curve.length} puntos guardados. ${trend(firstEquity, lastEquity)}`,
      drawdownSummary: `Drawdown máximo de la cuenta ${(maxDrawdown * 100).toFixed(1)}% sobre los ${usd(saved.startingEquity)} iniciales.`,
    },
    effectiveness: {
      startingEquity: saved.startingEquity,
      equity: saved.equity,
      totalReturn: saved.totalReturn,
      winRate: saved.winRate,
      profitFactor: saved.profitFactor,
      profitFactorUnbounded: saved.profitFactorUnbounded,
      maxDrawdown: saved.maxDrawdown,
      closed: saved.closed,
      tradeCount: saved.trades.length,
      currency: saved.currency,
      path: saved.path,
      updatedAt: saved.updatedAt,
      session: saved.sessions[saved.sessions.length - 1] ?? null,
    },
    kill: {
      active: state.kill.manual || state.kill.auto,
      manual: state.kill.manual,
      reason: state.kill.reason,
      limit: state.settings.dailyLossKillSol,
      realizedToday: state.kill.realizedToday,
    },
    settings: state.settings,
    meteora: state.meteora,
    leaders,
    equityCurve: curve.slice(-160),
    drawdownCurve: drawdown.slice(-160),
    positions: state.positions.map((position) => {
      const mark = state.prices[position.mint] ?? position.entryPrice;
      const leader = state.leaders.find((item) => item.id === position.leaderId);
      const proceeds = exitProceeds(
        position.qty,
        mark,
        state.settings.slippageBps,
        state.settings.feeBps,
      ).proceeds;
      return {
        id: position.id,
        leaderId: position.leaderId,
        leaderName: leader?.name ?? position.leaderId,
        symbol: position.symbol,
        mint: position.mint,
        qty: position.qty,
        entryPrice: position.entryPrice,
        mark,
        stopPrice: position.stopPrice,
        unrealized: proceeds - position.costSol,
        openedAt: position.openedAt,
      };
    }),
    trades: [...saved.trades].reverse().slice(0, 30).map((trade) => ({
      id: trade.id,
      ts: trade.timestamps.ts,
      symbol: trade.symbol,
      reasonLabel: TRADE_LABEL[trade.reason],
      leaderName: trade.leader,
      feeSol: trade.fees,
      pnlSol: trade.pnl,
    })),
    skips: [...state.skips].reverse().slice(0, 8).map((skip) => ({
      ...skip,
      reasons: skip.reasons.map((reason) => REASON_LABEL[reason]),
      leaderName: state.leaders.find((leader) => leader.id === skip.leaderId)?.name ?? skip.leaderId,
    })),
  };
}
