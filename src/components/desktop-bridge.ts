"use client";

import { useSyncExternalStore } from "react";

type Result = { ok: boolean; error?: string };

export type DesktopBridge = {
  importWallet: (secret: string, address: string) => Promise<Result & { address?: string }>;
  replaceWallet: (secret: string, address: string, confirm: string) => Promise<Result & { address?: string }>;
  settings: () => Promise<Result & { rpc?: string | null; address?: string | null }>;
  saveRpc: (url: string) => Promise<Result & { rpc?: string | null }>;
};

declare global {
  interface Window {
    /** Present only inside the desktop app (desktop/preload.ts). */
    pollo?: DesktopBridge;
  }
}

function noSubscribe(): () => void {
  return () => {};
}

/** The desktop bridge, or null in a browser. It never changes after load; the server render assumes a browser. */
export function useDesktop(): DesktopBridge | null {
  return useSyncExternalStore(noSubscribe, () => window.pollo ?? null, () => null);
}
