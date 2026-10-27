"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ImportResult = { ok: boolean; address?: string; error?: string };

declare global {
  interface Window {
    /** Present only inside the desktop app (desktop/preload.ts). */
    pollo?: { importWallet: (secret: string, address: string) => Promise<ImportResult> };
  }
}

function noSubscribe(): () => void {
  return () => {};
}

/**
 * Shown while there is no dedicated wallet. In the desktop app the key goes over IPC
 * to the main process, never over HTTP. In a browser the page only shows the CLI command.
 */
export function WalletImport({ onImported }: { onImported: () => void }) {
  // The bridge never changes after load; the server render assumes a browser.
  const desktop = useSyncExternalStore(noSubscribe, () => Boolean(window.pollo), () => false);
  const [secret, setSecret] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!desktop) {
    return (
      <div className="flex flex-col gap-2 px-3 py-3 text-sm">
        <p>No hay wallet dedicada. Importa la tuya desde una terminal en la carpeta del proyecto (la clave se escribe oculta):</p>
        <p className="num border border-border bg-black px-3 py-2">
          <span className="text-muted-foreground">$ </span>npm run wallet -- import TU_DIRECCION
        </p>
        <p className="text-xs text-muted-foreground">O usa la app de escritorio, que tiene este formulario. Nunca pegues la clave en una página web.</p>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 px-3 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        void window
          .pollo!.importWallet(secret, address)
          .then((result) => {
            if (result.ok) {
              setSecret("");
              setAddress("");
              onImported();
            } else {
              setError(result.error ?? "No se pudo importar.");
            }
          })
          .catch(() => setError("No se pudo importar."))
          .finally(() => setBusy(false));
      }}
    >
      <p className="text-sm">Importa la wallet que ya usas para el bot. Úsala solo para esto: el bot firma con ella sin preguntarte cada vez.</p>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Clave privada (Phantom → Exportar clave privada, o el arreglo de solana-keygen)</span>
        <Input
          className="num h-10 bg-black"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={secret}
          disabled={busy}
          onChange={(event) => setSecret(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Dirección pública (opcional, para comprobar que es la wallet correcta)</span>
        <Input className="num h-10 bg-black" autoComplete="off" spellCheck={false} value={address} disabled={busy} onChange={(event) => setAddress(event.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="min-h-10 px-5 font-bold tracking-widest" disabled={busy || !secret.trim()}>
          $ importar
        </Button>
        <p className="text-xs text-muted-foreground">Se guarda solo en esta computadora, en ~/.solana-paper-bot/wallet.json.</p>
      </div>
      {error ? <p className="glow-red text-sm text-destructive">[ERR] {error}</p> : null}
    </form>
  );
}
