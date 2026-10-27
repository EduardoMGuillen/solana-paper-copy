import { contextBridge, ipcRenderer } from "electron";

/** The only bridge the page gets: hand a key to the main process, which writes the wallet file. */
contextBridge.exposeInMainWorld("pollo", {
  importWallet: (secret: string, address: string): Promise<{ ok: boolean; address?: string; error?: string }> =>
    ipcRenderer.invoke("wallet:import", secret, address),
});
