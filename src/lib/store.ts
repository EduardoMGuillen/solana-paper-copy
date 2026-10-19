import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSeededState } from "./engine/demo";
import type { EngineState } from "./engine/types";
import { dataDir } from "./paths";

function stateFile(): string {
  return path.join(dataDir(), "paper-state.json");
}

export async function loadState(): Promise<EngineState> {
  try {
    const raw = await readFile(stateFile(), "utf8");
    const parsed = JSON.parse(raw) as EngineState;
    if (parsed.version !== 2 || !parsed.kill || !Array.isArray(parsed.leaders)) {
      throw new Error("estado incompatible");
    }
    parsed.series ??= {};
    parsed.drawdownCurve ??= [];
    parsed.meteora ??= {
      status: "idle",
      sourceName: "Meteora Stake2Earn",
      ranksWhat: "",
      windowLabel: "",
      vaultLabel: null,
      vaultAddress: null,
      refreshedAt: null,
      attemptedAt: null,
      error: null,
      wallets: [],
    };
    parsed.accountPeak ??= parsed.startingEquity;
    parsed.rpcCursor ??= 0;
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && code !== "ENOENT") {
      // A corrupt file is replaced so the desk can boot. The demo leaders come back.
    }
    const fresh = createSeededState(Date.now());
    await saveState(fresh);
    return fresh;
  }
}

export async function saveState(state: EngineState): Promise<void> {
  const file = stateFile();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(state));
  await rename(tmp, file);
}
