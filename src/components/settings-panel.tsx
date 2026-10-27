"use client";

import { useEffect, useState } from "react";
import { useDesktop } from "@/components/desktop-bridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const RPC_HINT = "For more speed, add a Helius or QuickNode RPC (both have a free plan). Without one, the bot uses the public Solana RPC, which is slow and rate-limited.";

/**
 * Paste, test and save the RPC URL. The URL goes over IPC to the desktop process, which checks it,
 * writes config.env and restarts the bot's server; the page only ever sees a masked copy.
 */
export function RpcForm({ current, onSaved, onSkip }: { current: string | null; onSaved: (masked: string | null) => void; onSkip?: () => void }) {
  const desktop = useDesktop();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!desktop) return <p className="px-3 py-3 text-sm">Set the RPC in the desktop app, or in SOLANA_RPC_URL in config.env.</p>;

  function save(value: string) {
    setBusy(true);
    setError(null);
    void desktop!
      .saveRpc(value)
      .then((result) => {
        if (result.ok) {
          setUrl("");
          onSaved(result.rpc ?? null);
        } else {
          setError(result.error ?? "Could not save.");
        }
      })
      .catch(() => setError("Could not save."))
      .finally(() => setBusy(false));
  }

  return (
    <form
      className="flex flex-col gap-3 px-3 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        save(url);
      }}
    >
      <p className="text-sm">{RPC_HINT}</p>
      <p className="num text-xs text-muted-foreground">current: {current ?? "public Solana RPC"}</p>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">RPC URL (e.g. https://mainnet.helius-rpc.com/?api-key=…)</span>
        <Input className="num h-10 bg-black" type="password" autoComplete="off" spellCheck={false} value={url} disabled={busy} onChange={(event) => setUrl(event.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="min-h-10 px-5 font-bold tracking-widest" disabled={busy || !url.trim()}>
          {busy ? "$ testing…" : "$ test and save"}
        </Button>
        {current && !onSkip ? (
          <Button type="button" variant="outline" className="min-h-10" disabled={busy} onClick={() => save("")}>
            use public
          </Button>
        ) : null}
        {onSkip ? (
          <Button type="button" variant="outline" className="min-h-10" disabled={busy} onClick={onSkip}>
            skip
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">On save, the bot restarts by itself in a few seconds. Positions stay open on chain.</p>
      {error ? <p className="glow-red text-sm text-destructive">[ERR] {error}</p> : null}
    </form>
  );
}

function WalletReplace({ address, blocked, onReplaced }: { address: string; blocked: string | null; onReplaced: () => void }) {
  const desktop = useDesktop();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [expected, setExpected] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className="min-h-10" disabled={Boolean(blocked)} onClick={() => setOpen(true)}>
          change wallet
        </Button>
        {blocked ? <p className="text-xs text-warn">{blocked}</p> : null}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        void desktop!
          .replaceWallet(secret, expected, confirm)
          .then((result) => {
            if (result.ok) {
              setSecret("");
              setOpen(false);
              onReplaced();
            } else {
              setError(result.error ?? "Could not change the wallet.");
            }
          })
          .catch(() => setError("Could not change the wallet."))
          .finally(() => setBusy(false));
      }}
    >
      <p className="text-sm">The current key is not deleted: it is kept as a backup in the same private folder, with its address and the date in the file name.</p>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Private key of the new wallet</span>
        <Input className="num h-10 bg-black" type="password" autoComplete="off" spellCheck={false} value={secret} disabled={busy} onChange={(event) => setSecret(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">New public address (optional, to verify)</span>
        <Input className="num h-10 bg-black" autoComplete="off" spellCheck={false} value={expected} disabled={busy} onChange={(event) => setExpected(event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">To confirm, type the last 4 characters of the current wallet (…{address.slice(-4)})</span>
        <Input className="num h-10 w-32 bg-black" autoComplete="off" spellCheck={false} maxLength={4} value={confirm} disabled={busy} onChange={(event) => setConfirm(event.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="destructive" className="min-h-10 px-5 font-bold tracking-widest" disabled={busy || !secret.trim() || confirm.trim().length !== 4}>
          $ change
        </Button>
        <Button type="button" variant="outline" className="min-h-10" disabled={busy} onClick={() => setOpen(false)}>
          cancel
        </Button>
      </div>
      {error ? <p className="glow-red text-sm text-destructive">[ERR] {error}</p> : null}
    </form>
  );
}

/** The ⚙ panel: RPC and wallet. Only the desktop app can change them; a browser gets the file to edit. */
export function SettingsPanel({ running, positions, onChanged }: { running: boolean; positions: number; onChanged: () => void }) {
  const desktop = useDesktop();
  const [rpc, setRpc] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let stop = false;
    void desktop.settings().then((result) => {
      if (stop || !result.ok) return;
      setRpc(result.rpc ?? null);
      setAddress(result.address ?? null);
    });
    return () => {
      stop = true;
    };
  }, [desktop]);

  if (!desktop) {
    return <p className="px-3 py-3 text-sm">Settings are changed in the desktop app. In a browser, edit SOLANA_RPC_URL in .env.local and use npm run wallet for the wallet.</p>;
  }

  const blocked = running ? "STOP the bot first." : positions > 0 ? "Close open positions before changing the wallet." : null;

  return (
    <div className="flex flex-col divide-y divide-border">
      <section>
        <h3 className="px-3 pt-3 text-xs tracking-widest text-muted-foreground">RPC</h3>
        <RpcForm
          current={rpc}
          onSaved={(masked) => {
            setRpc(masked);
            setSaved("RPC saved. The bot restarts in a few seconds.");
            onChanged();
          }}
        />
        {saved ? <p className="px-3 pb-3 text-sm text-primary">[OK] {saved}</p> : null}
      </section>
      <section className="flex flex-col gap-3 px-3 py-3">
        <h3 className="text-xs tracking-widest text-muted-foreground">WALLET</h3>
        <p className="num text-sm break-all">{address ?? "—"}</p>
        {address ? (
          <WalletReplace
            address={address}
            blocked={blocked}
            onReplaced={() => {
              void desktop.settings().then((result) => result.ok && setAddress(result.address ?? null));
              onChanged();
            }}
          />
        ) : null}
      </section>
    </div>
  );
}
