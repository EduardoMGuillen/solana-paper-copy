import { flattenOpenPositions } from "./engine/engine";
import { writeEffectiveness } from "./effectiveness";
import { saveState } from "./store";

const g = globalThis as {
  __paperHooks?: boolean;
  __paperClosing?: boolean;
};

export async function flattenAndFlush(): Promise<{ closed: number; datasetPath: string }> {
  const { withState } = await import("./service");
  return withState(async (state) => {
    const now = Date.now();
    const closed = flattenOpenPositions(state, now);
    await saveState(state);
    const dataset = await writeEffectiveness(state, { closing: true });
    return { closed, datasetPath: dataset.path };
  });
}

/**
 * The Next server keeps trading only while this process is alive.
 * On a normal stop, flatten and wait for the dataset rename before exiting.
 * Set NEXT_MANUAL_SIG_HANDLE=1 so Next does not call process.exit first,
 * and NEXT_EXIT_TIMEOUT_MS high enough that the parent does not SIGKILL early.
 */
export function installShutdownHooks(): void {
  if (g.__paperHooks) return;
  g.__paperHooks = true;
  console.log("Cierre en papel registrado para SIGINT y SIGTERM.");

  const onSignal = (signal: NodeJS.Signals) => {
    if (g.__paperClosing) return;
    g.__paperClosing = true;
    const code = signal === "SIGINT" ? 130 : 143;
    void flattenAndFlush()
      .then((result) => {
        console.log(
          `Mesa cerrada. ${result.closed} copias liquidadas al último precio. Dataset en ${result.datasetPath}.`,
        );
      })
      .catch((error: unknown) => {
        console.error("No se pudo guardar el cierre de la mesa en papel.", error);
      })
      .finally(() => {
        process.exit(code);
      });
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}
