"use client";

import { useState } from "react";
import { useDesktop } from "@/components/desktop-bridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Shown while there is no dedicated wallet. In the desktop app the key goes over IPC
 * to the main process, never over HTTP. In a browser the page only shows the CLI command.
 */
export function WalletImport({ onImported }: { onImported: () => void }) {
  const desktop = useDesktop();
  const [secret, setSecret] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!desktop) {
    return (
      <div className="flex flex-col gap-2 px-3 py-3 text-sm">
        <p>No dedicated wallet. Import yours from a terminal in the project folder (the key is typed hidden):</p>
        <p className="num border border-border bg-black px-3 py-2">
          <span className="text-muted-foreground">$ </span>npm run wallet -- import YOUR_ADDRESS
        </p>
        <p className="text-xs text-muted-foreground">Or use the desktop app, which has this form. Never paste the key into a web page.</p>
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
        void desktop
          .importWallet(secret, address)
          .then((result) => {
            if (result.ok) {
              setSecret("");
              setAddress("");
              onImported();
            } else {
              setError(result.error ?? "Could not import.");
            }
          })
          .catch(() => setError("Could not import."))
          .finally(() => setBusy(false));
      }}
    >
      <p className="text-sm">Import the wallet you use for the bot. Use it only for this: the bot signs with it without asking you each time.</p>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Private key (Phantom → Export private key, or the solana-keygen array)</span>
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
        <span className="text-xs text-muted-foreground">Public address (optional, to verify it is the right wallet)</span>
        <Input className="num h-10 bg-black" autoComplete="off" spellCheck={false} value={address} disabled={busy} onChange={(event) => setAddress(event.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="min-h-10 px-5 font-bold tracking-widest" disabled={busy || !secret.trim()}>
          $ import
        </Button>
        <p className="text-xs text-muted-foreground">Stored only on this computer, in ~/.solana-paper-bot/wallet.json.</p>
      </div>
      {error ? <p className="glow-red text-sm text-destructive">[ERR] {error}</p> : null}
    </form>
  );
}
