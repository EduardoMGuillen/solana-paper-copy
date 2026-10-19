import type { MeteoraWallet } from "./engine/types";

export const METEORA_SOURCE = "Meteora Stake2Earn";
export const METEORA_RANKS =
  "Meteora no publica un ranking de traders sin clave. Esta lista es el top de stakers por stake activo en el vault Stake2Earn con más dólares stakeados.";
export const METEORA_WINDOW = "Sin ventana temporal: orden vigente por stake activo";
export const TOP_COUNT = 7;

const VAULTS_URL = "https://stake-for-fee-api.meteora.ag/vault/all";

type VaultSummary = {
  vault_address?: string;
  token_a_symbol?: string;
  token_b_symbol?: string;
  total_staked_amount_usd?: number | string;
};

type TopEntry = {
  owner?: string;
  staked_amount?: number | string;
  token_a_accumulated_reward_usd?: number | string;
  token_b_accumulated_reward_usd?: number | string;
};

export type MeteoraResult =
  | {
      ok: true;
      vaultLabel: string;
      vaultAddress: string;
      wallets: MeteoraWallet[];
    }
  | { ok: false; error: string };

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function pickTopVault(vaults: VaultSummary[]): VaultSummary | null {
  let best: VaultSummary | null = null;
  let bestUsd = -1;
  for (const vault of vaults) {
    if (!vault.vault_address) continue;
    const usd = asNumber(vault.total_staked_amount_usd);
    if (usd > bestUsd) {
      best = vault;
      bestUsd = usd;
    }
  }
  return best;
}

export function parseTopStakers(entries: TopEntry[]): MeteoraWallet[] {
  return entries
    .map((entry) => ({
      address: (entry.owner ?? "").trim(),
      stakedAmount: asNumber(entry.staked_amount),
      rewardUsd:
        asNumber(entry.token_a_accumulated_reward_usd) +
        asNumber(entry.token_b_accumulated_reward_usd),
    }))
    .filter((entry) => entry.address.length >= 32 && entry.stakedAmount > 0)
    .sort((a, b) => b.stakedAmount - a.stakedAmount)
    .slice(0, TOP_COUNT)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Meteora respondió ${response.status}`);
  }
  return response.json();
}

export async function fetchMeteoraTop(): Promise<MeteoraResult> {
  try {
    const list = (await getJson(VAULTS_URL)) as { data?: VaultSummary[] };
    const vaults = Array.isArray(list.data) ? list.data : [];
    const vault = pickTopVault(vaults);
    if (!vault?.vault_address) {
      return { ok: false, error: "Meteora no devolvió vaults Stake2Earn." };
    }
    const detail = (await getJson(
      `https://stake-for-fee-api.meteora.ag/vault/${vault.vault_address}`,
    )) as { top_lists?: TopEntry[] };
    const wallets = parseTopStakers(detail.top_lists ?? []);
    if (wallets.length === 0) {
      return { ok: false, error: "El vault de Meteora no trajo stakers." };
    }
    const pair = [vault.token_a_symbol, vault.token_b_symbol].filter(Boolean).join("/");
    return {
      ok: true,
      vaultAddress: vault.vault_address,
      vaultLabel: pair ? `${pair} · vault ${vault.vault_address.slice(0, 4)}…${vault.vault_address.slice(-4)}` : vault.vault_address,
      wallets,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error de red";
    return {
      ok: false,
      error: `La fuente de Meteora no está disponible (${message}). Los líderes demo siguen activos.`,
    };
  }
}
