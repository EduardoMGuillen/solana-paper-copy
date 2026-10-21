"use client";

import { useEffect, useState } from "react";
import { METEORA_STARTING_SOL } from "@/lib/bot/balances";

function sol(value: number): string {
  return `${value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} SOL`;
}

/** Two paper experiments. Neither balance is taken from the other. */
export function ExperimentBalances({ tradesSol }: { tradesSol: number | null }) {
  const [meteoraSol, setMeteoraSol] = useState(METEORA_STARTING_SOL);
  const [meteoraNote, setMeteoraNote] = useState("Su propio sol. Los trades no lo restan.");
  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const response = await fetch("/api/meteora/live", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as {
          equity?: number;
          opens?: { name?: string; result?: number; priceRatio?: number }[];
        };
        if (stop || typeof body.equity !== "number") return;
        setMeteoraSol(body.equity);
        const opens = (body.opens ?? []).flatMap((open) =>
          typeof open.result === "number" && typeof open.priceRatio === "number"
            ? [{ name: open.name, result: open.result, priceRatio: open.priceRatio }]
            : [],
        );
        if (opens.length === 1) {
          const open = opens[0];
          const pos = `${open.result >= 0 ? "+" : ""}${(open.result * 100).toFixed(2)}%`;
          const token = `${open.priceRatio - 1 >= 0 ? "+" : ""}${((open.priceRatio - 1) * 100).toFixed(2)}%`;
          setMeteoraNote(`${open.name ?? "Posición"} · token ${token} · posición ${pos}`);
        } else if (opens.length > 1) {
          setMeteoraNote(
            opens
              .map((open) => {
                const pos = `${open.result >= 0 ? "+" : ""}${(open.result * 100).toFixed(2)}%`;
                return `${open.name ?? "Posición"} ${pos}`;
              })
              .join(" · "),
          );
        }
      } catch {
        // The deposited SOL stays on screen if the live file cannot be read.
      }
    }
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 15_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <div className="rounded-lg border border-border px-3 py-2">
        <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Trades de Solana</p>
        <p className="num text-lg">{tradesSol === null ? "—" : sol(tradesSol)}</p>
        <p className="text-xs text-muted-foreground">Su propio sol. Meteora no lo resta.</p>
      </div>
      <div className="rounded-lg border border-border px-3 py-2">
        <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Meteora</p>
        <p className="num text-lg">{sol(meteoraSol)}</p>
        <p className="text-xs text-muted-foreground">{meteoraNote}</p>
      </div>
    </div>
  );
}
