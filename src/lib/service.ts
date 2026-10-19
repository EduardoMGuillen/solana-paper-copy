import { stepDemo } from "./engine/demo";
import {
  addWalletLeader,
  applyFill,
  applyMeteoraRoster,
  applyProtectiveStops,
  applySettings,
  markMeteoraUnavailable,
  removeLeader,
  rollover,
  setKill,
  setLeaderEnabled,
} from "./engine/engine";
import { clampSettings } from "./engine/settings";
import type { EngineState, RiskSettings } from "./engine/types";
import { toView, type DeskView } from "./engine/view";
import { fetchMeteoraTop } from "./meteora";
import { pollWalletSwaps } from "./rpc";
import { loadState, saveState } from "./store";

const g = globalThis as unknown as { __paperQueue?: Promise<unknown> };

function withState<T>(fn: (state: EngineState) => Promise<T>): Promise<T> {
  const previous = g.__paperQueue ?? Promise.resolve();
  const job = previous.then(() => loadState()).then(fn);
  g.__paperQueue = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

async function refreshMeteora(state: EngineState, now: number): Promise<void> {
  const last = state.meteora.attemptedAt ?? 0;
  const wait = state.meteora.error ? 30_000 : 180_000;
  if (last && now - last < wait) return;
  state.meteora.attemptedAt = now;
  const result = await fetchMeteoraTop();
  if (!result.ok) {
    markMeteoraUnavailable(state, result.error, now);
    return;
  }
  applyMeteoraRoster(state, result.wallets, {
    vaultLabel: result.vaultLabel,
    vaultAddress: result.vaultAddress,
    refreshedAt: now,
  });
}

async function pollOneWallet(state: EngineState, now: number): Promise<void> {
  const candidates = state.leaders.filter(
    (leader) => leader.wallet && (leader.kind === "wallet" || (leader.kind === "meteora" && leader.enabled)),
  );
  if (candidates.length === 0) return;
  const leader = candidates[state.rpcCursor % candidates.length];
  state.rpcCursor += 1;
  if (leader.lastPollAt && now - leader.lastPollAt < 25_000) return;
  leader.lastPollAt = now;
  try {
    const polled = await pollWalletSwaps(leader.wallet!, leader.seenSignatures, now);
    leader.seenSignatures = polled.seen;
    leader.rpcError = null;
    for (const fill of polled.fills) {
      fill.leaderId = leader.id;
      applyFill(state, fill);
    }
  } catch (error) {
    leader.rpcError =
      error instanceof Error
        ? error.message
        : "El RPC no respondió. El modo demo sigue activo.";
  }
}

async function tick(state: EngineState): Promise<EngineState> {
  const now = Date.now();
  rollover(state, now);
  if (now - state.updatedAt >= 2_500) {
    stepDemo(state, now);
  }
  await refreshMeteora(state, now);
  await pollOneWallet(state, now);
  applyProtectiveStops(state, now);
  await saveState(state);
  return state;
}

export function readDesk(): Promise<DeskView> {
  return withState(async (state) => toView(await tick(state)));
}

export function runAction(body: {
  type?: string;
  active?: boolean;
  id?: string;
  enabled?: boolean;
  wallet?: string;
  settings?: Partial<RiskSettings>;
}): Promise<{ ok: true; view: DeskView } | { ok: false; error: string; view: DeskView }> {
  return withState(async (state) => {
    const now = Date.now();
    let error: string | null = null;
    if (body.type === "kill") setKill(state, Boolean(body.active), now);
    else if (body.type === "toggle") error = setLeaderEnabled(state, body.id ?? "", Boolean(body.enabled));
    else if (body.type === "add-wallet") error = addWalletLeader(state, body.wallet ?? "", now);
    else if (body.type === "remove") error = removeLeader(state, body.id ?? "", now);
    else if (body.type === "settings") applySettings(state, clampSettings(body.settings));
    else if (body.type === "reset") {
      const { createSeededState } = await import("./engine/demo");
      const fresh = createSeededState(now);
      await saveState(fresh);
      return { ok: true as const, view: toView(fresh) };
    } else error = "Acción desconocida.";
    await saveState(state);
    const view = toView(state);
    return error ? { ok: false as const, error, view } : { ok: true as const, view };
  });
}
