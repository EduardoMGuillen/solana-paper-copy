import { contextBridge, ipcRenderer } from "electron";

type Result = { ok: boolean; error?: string };

/** The only bridge the page gets. Keys and the RPC URL go to the main process, which writes the files. */
contextBridge.exposeInMainWorld("pollo", {
  importWallet: (secret: string, address: string): Promise<Result & { address?: string }> => ipcRenderer.invoke("wallet:import", secret, address),
  replaceWallet: (secret: string, address: string, confirm: string): Promise<Result & { address?: string }> =>
    ipcRenderer.invoke("wallet:replace", secret, address, confirm),
  settings: (): Promise<Result & { rpc?: string | null; address?: string | null }> => ipcRenderer.invoke("settings:get"),
  saveRpc: (url: string): Promise<Result & { rpc?: string | null }> => ipcRenderer.invoke("rpc:save", url),
});
