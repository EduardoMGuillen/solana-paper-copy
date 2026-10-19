import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBotState, type BotState } from "./bot/engine";
import { clampBotSettings } from "./bot/settings";
import { dataDir } from "./paths";

function stateFile(): string {
  return path.join(dataDir(), "bot-state.json");
}

export async function loadState(): Promise<BotState> {
  try {
    const parsed = JSON.parse(await readFile(stateFile(), "utf8")) as BotState;
    if (parsed.version !== 3 || !Array.isArray(parsed.books) || !parsed.halt) {
      throw new Error("estado incompatible");
    }
    parsed.settings = clampBotSettings(parsed.settings);
    return parsed;
  } catch {
    // Missing or from the old copy desk: start a fresh paper account.
    const fresh = createBotState(Date.now());
    await saveState(fresh);
    return fresh;
  }
}

export async function saveState(state: BotState): Promise<void> {
  const file = stateFile();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(state));
  await rename(tmp, file);
}
