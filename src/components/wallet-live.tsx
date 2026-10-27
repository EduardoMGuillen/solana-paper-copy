"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "@/components/logo";
import { WalletImport } from "@/components/wallet-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LivePosition } from "@/lib/exec/live-book";
import { LIVE_PRESETS, sameLiveParams, type LiveParams } from "@/lib/exec/live-params";
import type { ClosedPosition, PortfolioRow, WalletStatus } from "@/lib/exec/wallet";

type FormState = {
  slotPct: string;
  minTvl: string;
  minFees24h: string;
  minBaseFeePct: string;
  minVolume1h: string;
  takeProfitPct: string;
  stopLossPct: string;
  holdHours: string;
  rangePct: string;
  binStepPct: string;
  minAgeDays: string;
};

function plain(value: number, digits = 2): string {
  return Number(value.toFixed(digits)).toString();
}

function formFrom(params: LiveParams): FormState {
  return {
    slotPct: plain(params.slot * 100),
    minTvl: plain(params.minTvl, 0),
    minFees24h: plain(params.minFees24h, 0),
    minBaseFeePct: plain(params.minBaseFeePct, 2),
    minVolume1h: plain(params.minVolume1h, 0),
    takeProfitPct: plain(params.takeProfit * 100),
    stopLossPct: plain(params.stopLoss * 100),
    holdHours: plain(params.holdHours, 0),
    rangePct: plain(params.range * 100),
    binStepPct: plain(params.binStep * 100, 2),
    minAgeDays: plain(params.minAgeDays, 0),
  };
}

function readNumber(value: string): number {
  return Number(value.trim().replace(",", "."));
}

function payloadFrom(form: FormState): LiveParams | null {
  const slot = readNumber(form.slotPct);
  const minTvl = readNumber(form.minTvl);
  const minFees24h = readNumber(form.minFees24h);
  const minBaseFeePct = readNumber(form.minBaseFeePct);
  const minVolume1h = readNumber(form.minVolume1h);
  const takeProfit = readNumber(form.takeProfitPct);
  const stopLoss = readNumber(form.stopLossPct);
  const holdHours = readNumber(form.holdHours);
  const range = readNumber(form.rangePct);
  const binStep = readNumber(form.binStepPct);
  const minAgeDays = readNumber(form.minAgeDays);
  const numbers = [slot, minTvl, minFees24h, minBaseFeePct, minVolume1h, takeProfit, stopLoss, holdHours, range, binStep, minAgeDays];
  if (numbers.some((value) => !Number.isFinite(value))) return null;
  return {
    slot: slot / 100,
    minTvl,
    minFees24h,
    minBaseFeePct,
    minVolume1h,
    takeProfit: takeProfit / 100,
    stopLoss: stopLoss / 100,
    holdHours,
    range: range / 100,
    binStep: binStep / 100,
    minAgeDays,
  };
}

function sol(value: number): string {
  return `${value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} SOL`;
}

function usd(value: number): string {
  return value.toLocaleString("es-ES", { maximumFractionDigits: 0 });
}

function money(value: number): string {
  return value.toLocaleString("es-ES", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function WalletLive() {
  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);

  function markDirty(value: boolean) {
    dirtyRef.current = value;
    setDirty(value);
  }

  const [reload, setReload] = useState(0);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const response = await fetch("/api/wallet", { cache: "no-store" });
        const body = (await response.json()) as WalletStatus;
        if (stop) return;
        if (!response.ok) throw new Error("La wallet no respondió.");
        setStatus(body);
        if (!dirtyRef.current) setForm(formFrom(body.params));
        setError(null);
      } catch (cause) {
        if (!stop) setError(cause instanceof Error ? cause.message : "No se pudo leer la wallet.");
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
  }, [reload]);

  async function post(body: { running?: boolean; params?: LiveParams; close?: string }) {
    setBusy(true);
    setActionError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/wallet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string | null; status?: WalletStatus };
      if (payload.status) {
        setStatus(payload.status);
        if (body.params) setForm(formFrom(payload.status.params));
      }
      if (!response.ok) {
        setActionError(payload.error ?? "No se pudo cambiar el bot.");
        return false;
      }
      return true;
    } catch {
      setActionError("El bot no respondió.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const running = status?.running === true;
  const openPositions = status?.positions ?? [];
  const portfolio = status?.portfolio;
  const poolsSol = portfolio?.poolsSol ?? 0;
  const totalSol = portfolio?.totalSol ?? null;
  const price = status?.solUsd != null && status.solUsd > 0 ? status.solUsd : null;
  const rentMissing = (portfolio?.rows ?? []).some((row) => row.rentSol == null) && openPositions.some((position) => position.position);
  const locked = !status || running || status.kill;
  const address = status?.address ?? null;
  const params = status?.params;
  const draft = form ? payloadFrom(form) : null;
  const activePreset = draft ? (LIVE_PRESETS.find((preset) => sameLiveParams(draft, preset.params))?.id ?? null) : null;
  const rangePct = params ? params.range * 100 : 75;

  const copyAddress = () => {
    if (!address) return;
    const mark = (ok: boolean) => {
      setCopyFailed(!ok);
      setCopied(ok);
      if (ok) window.setTimeout(() => setCopied(false), 1500);
    };
    void navigator.clipboard.writeText(address).then(
      () => mark(true),
      () => {
        const input = document.createElement("textarea");
        input.value = address;
        input.setAttribute("readonly", "");
        document.body.appendChild(input);
        input.select();
        const ok = document.execCommand("copy");
        input.remove();
        mark(ok);
      },
    );
  };

  const state = !status ? "BOOTING" : status.kill ? "KILL" : running ? "RUNNING" : "STOPPED";
  const errors = [error, actionError, status?.error].filter((line): line is string => Boolean(line));

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-3 py-3 sm:px-5">
      <header className="sticky top-0 z-20 border border-border bg-black/90 backdrop-blur">
        <div className="flex flex-col gap-3 px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Logo className="size-10 shrink-0" />
            <div>
              <h1 className="glow text-base leading-none font-bold tracking-[0.2em] sm:text-lg">POLLOTRADERBOT</h1>
              <p className="text-[11px] text-muted-foreground">meteora://dlmm/bid-ask · solana mainnet</p>
            </div>
            <StatePill state={state} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="num flex min-h-10 items-center gap-2 border border-border px-3 text-xs hover:border-primary disabled:opacity-50"
              disabled={!address}
              onClick={copyAddress}
              title={address ?? undefined}
            >
              <span className="text-muted-foreground">wallet</span>
              <span>{address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "—"}</span>
              <span className="text-muted-foreground">{copied ? "[copiada]" : copyFailed ? "[error]" : "[copiar]"}</span>
            </button>
            <div className="num flex min-h-10 items-center gap-2 border border-border px-3 text-sm">
              <span className="glow">{status?.balanceSol == null ? "—" : sol(status.balanceSol)}</span>
              {status?.balanceUsd != null ? <span className="text-xs text-muted-foreground">{money(status.balanceUsd)}</span> : null}
            </div>
            <Button type="button" className="glow-none min-h-10 px-5 font-bold tracking-widest" disabled={!status || busy || running || status.kill} aria-pressed={running} onClick={() => void post({ running: true })}>
              ▶ START
            </Button>
            <Button type="button" variant="destructive" className="min-h-10 border border-destructive/60 px-5 font-bold tracking-widest" disabled={!status || busy || (!running && (status.positions?.length ?? 0) === 0)} aria-pressed={!running} onClick={() => void post({ running: false })}>
              ■ STOP
            </Button>
          </div>
        </div>
      </header>

      <Panel title="sys.log">
        <div className="flex flex-col gap-1 px-3 py-2 text-sm">
          <p>
            <span className="text-muted-foreground">root@pollo:~$ </span>
            <span className="cursor">{status?.notice ?? "Start abre posiciones reales con esta wallet. Stop las cierra todas. Cada fila se puede cerrar sola."}</span>
          </p>
          {status?.balanceSol === 0 ? <p className="text-warn">[WARN] La wallet está en 0 SOL: no se abre nada y no se envía ninguna transacción.</p> : null}
          {status?.kill ? <p className="glow-red text-destructive">[KILL] Existe el archivo KILL: el bot no firma nada.</p> : null}
          {errors.map((line) => (
            <p key={line} className="glow-red text-destructive">[ERR] {line}</p>
          ))}
          {status ? (
            <p className="num text-xs text-muted-foreground">
              firma={status.signing ? "sí" : "no"} · tope={sol(status.limits.lpMaxSol)} · reserva={sol(status.limits.minReserveSol)} · journal={status.journal}
            </p>
          ) : null}
        </div>
      </Panel>

      {status && !status.address ? (
        <Panel title="wallet.import">
          <WalletImport onImported={() => setReload((n) => n + 1)} />
        </Panel>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric k="total" v={totalSol == null ? "—" : sol(totalSol)} hint={totalSol == null || price == null ? "Wallet, liquidez y alquiler" : money(totalSol * price)} />
        <Metric k="wallet" v={status?.balanceSol == null ? "—" : sol(status.balanceSol)} hint={status?.balanceUsd == null ? (status?.balanceSol === 0 ? "Sin fondos" : "Libre en la wallet") : money(status.balanceUsd)} />
        <Metric k="en_pools" v={sol(poolsSol)} hint={poolsSol === 0 ? "Sin liquidez puesta" : price == null ? "Liquidez y alquiler" : money(poolsSol * price)} />
        <Metric k="posiciones" v={String(openPositions.length)} hint={rentMissing ? "Falta el alquiler de una posición" : params ? `Cada nueva usa el ${plain(params.slot * 100, 0)}%` : "—"} />
      </div>

      <Panel title="positions" right={`${running ? "running" : "stopped"} · ${openPositions.length} abiertas`}>
        {openPositions.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-muted-foreground">-- sin posiciones abiertas --</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {running
                ? status?.balanceSol === 0
                  ? "El bot está encendido y la wallet sigue en 0 SOL. No hay liquidez que poner en un pool."
                  : "El bot está encendido. Todavía no hay una posición abierta."
                : "El bot está apagado. Start es el que empieza a abrir."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="num w-full min-w-[920px] text-left text-sm">
              <thead className="text-[11px] tracking-wider text-muted-foreground uppercase">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 font-medium">Pool</th>
                  <th className="px-3 py-2 font-medium">Tamaño</th>
                  <th className="px-3 py-2 font-medium">Valor</th>
                  <th className="px-3 py-2 font-medium">Token</th>
                  <th className="px-3 py-2 font-medium">Posición</th>
                  <th className="px-3 py-2 font-medium">Tiempo</th>
                  <th className="px-3 py-2 font-medium">Qué pasa</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {openPositions.map((position) => (
                  <PositionRow
                    key={position.address}
                    position={position}
                    holding={portfolio?.rows.find((row) => row.address === position.address) ?? null}
                    solUsd={price}
                    busy={busy}
                    onClose={() => void post({ close: position.address })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid gap-px border-t border-border bg-border sm:grid-cols-3">
          <Readout k="token" v="Precio contra la entrada" text="Si el token sube, el SOL sigue quieto debajo del precio. La fila se queda plana." />
          <Readout k="posición" v="Lo que le pasa al SOL" text="Suma la marca de la liquidez y las comisiones. No es el mismo porcentaje que el token." />
          <Readout
            k="salida"
            v={params ? `+${plain(params.takeProfit * 100, 0)}% · −${plain(params.stopLoss * 100, 0)}% · ${plain(params.holdHours, 0)} h` : "—"}
            text="Cierra al llegar a la toma, al stop o al cumplirse el tiempo."
          />
        </div>

        <div className="border-t border-border px-3 py-3">
          <div className="mb-2 flex items-center justify-between text-[11px] tracking-wider text-muted-foreground uppercase">
            <span>Rango Bid-Ask</span>
            <span className="num">−{plain(rangePct, 0)}% → entrada</span>
          </div>
          <BinRange rangePct={rangePct} />
          <p className="mt-2 text-xs text-muted-foreground">
            El precio tiene que bajar de la entrada para que el SOL empiece a convertirse en el token. Mientras esté arriba, la posición ni gana ni pierde por el precio.
          </p>
        </div>
      </Panel>

      <HistoryPanel history={status?.history ?? []} solUsd={price} />

      <Panel
        title="config"
        right={
          <button type="button" className="text-xs hover:underline" aria-expanded={configOpen} onClick={() => setConfigOpen((open) => !open)}>
            {configOpen ? "[ocultar]" : "[mostrar]"}
          </button>
        }
      >
        <p className="px-3 py-2 text-sm text-muted-foreground">
          {dirty
            ? "Hay cambios sin guardar."
            : params
              ? `${plain(params.slot * 100, 0)}% por posición · +${plain(params.takeProfit * 100, 0)}% / −${plain(params.stopLoss * 100, 0)}% / ${plain(params.holdHours, 0)} h`
              : "Leyendo los parámetros…"}
        </p>

        {configOpen ? (
          <div className="border-t border-border">
            <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-end sm:justify-between">
              <p className="max-w-2xl text-sm text-muted-foreground">
                {!status ? "Leyendo los parámetros…" : locked ? "Bloqueados con el bot encendido. Stop los deja editables." : "Elige un perfil o ajusta a mano. Guardar no enciende el bot."}
              </p>
              <div className="flex flex-wrap gap-2">
                {LIVE_PRESETS.map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    variant={activePreset === preset.id ? "default" : "outline"}
                    className="min-h-10"
                    disabled={locked || busy}
                    aria-pressed={activePreset === preset.id}
                    onClick={() => {
                      setForm(formFrom(preset.params));
                      markDirty(true);
                      setSaved(false);
                    }}
                  >
                    {preset.name}
                  </Button>
                ))}
              </div>
            </div>

            {form ? (
              <form
                className="flex flex-col gap-4 px-3 pb-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = form ? payloadFrom(form) : null;
                  if (!next) {
                    setActionError("Revisa los números antes de guardar.");
                    return;
                  }
                  void post({ params: next }).then((ok) => {
                    if (ok) {
                      markDirty(false);
                      setSaved(true);
                    }
                  });
                }}
              >
                <p className="text-sm text-muted-foreground">{LIVE_PRESETS.find((preset) => preset.id === activePreset)?.blurb ?? "Perfil a mano."}</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <Group title="tamaño">
                    <Field label="Por posición" suffix="%" value={form.slotPct} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "slotPct", value)} hint="Del SOL de esta wallet." />
                  </Group>
                  <Group title="entrada">
                    <Field label="TVL mínimo" suffix="US$" value={form.minTvl} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "minTvl", value)} hint="Liquidez del pool." />
                    <Field label="Comisiones 24 h" suffix="US$" value={form.minFees24h} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "minFees24h", value)} hint="Lo que el pool cobró en un día." />
                    <Field label="Comisión base" suffix="%" value={form.minBaseFeePct} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "minBaseFeePct", value)} hint="Fee del pool." />
                    <Field label="Volumen 1 h" suffix="US$" value={form.minVolume1h} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "minVolume1h", value)} hint="Operación reciente del pool." />
                    <Field label="Antigüedad mínima" suffix="días" value={form.minAgeDays} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "minAgeDays", value)} hint="Evita pools recién creados. 0 = cualquiera." />
                  </Group>
                  <Group title="salida_y_rango">
                    <Field label="Toma de ganancia" suffix="%" value={form.takeProfitPct} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "takeProfitPct", value)} hint="Cierra la posición al llegar aquí." />
                    <Field label="Stop" suffix="%" value={form.stopLossPct} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "stopLossPct", value)} hint="Cierra si la posición cae esto." />
                    <Field label="Tiempo máximo" suffix="h" value={form.holdHours} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "holdHours", value)} hint="Cierra aunque no haya toma ni stop." />
                    <Field label="Rango bajo la entrada" suffix="%" value={form.rangePct} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "rangePct", value)} hint="Hasta dónde se reparte el SOL." />
                    <Field label="Ancho de bin" suffix="%" value={form.binStepPct} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "binStepPct", value)} hint="Separación entre bins." />
                  </Group>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" className="min-h-10 px-5 font-bold tracking-widest" disabled={locked || busy || !dirty}>
                    $ guardar
                  </Button>
                  <p className="text-sm text-muted-foreground" aria-live="polite">
                    {saved ? "Guardado." : dirty ? "Hay cambios sin guardar." : `TVL ${params ? usd(params.minTvl) : "—"} · fee 24 h ${params ? usd(params.minFees24h) : "—"}.`}
                  </p>
                </div>
              </form>
            ) : (
              <p className="px-3 py-6 text-sm text-muted-foreground">Leyendo los parámetros…</p>
            )}
          </div>
        ) : null}
      </Panel>

      <footer className="num pb-2 text-center text-[11px] text-muted-foreground">01010000 01001111 01001100 01001100 01001111 · PolloTraderBot</footer>
    </main>
  );
}


function setField(
  setForm: (value: FormState | null | ((current: FormState | null) => FormState | null)) => void,
  markDirty: (value: boolean) => void,
  setSaved: (value: boolean) => void,
  key: keyof FormState,
  value: string,
) {
  setForm((current) => (current ? { ...current, [key]: value } : current));
  markDirty(true);
  setSaved(false);
}

function pct(value: number | null): string {
  if (value === null) return "—";
  const body = `${(value * 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  return value > 0 ? `+${body}` : body;
}

function hoursOpen(openedAt: number): string {
  const hours = Math.max(0, (Date.now() - openedAt) / 3_600_000);
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toLocaleString("es-ES", { maximumFractionDigits: 1 })} h`;
}

function signedMoney(value: number): string {
  if (value > 0) return `+${money(value)}`;
  if (value < 0) return `−${money(Math.abs(value))}`;
  return money(0);
}

function signedSol(value: number): string {
  const body = sol(Math.abs(value));
  if (value > 0) return `+${body}`;
  if (value < 0) return `−${body}`;
  return body;
}

function PositionRow({ position, holding, solUsd, busy, onClose }: { position: LivePosition; holding: PortfolioRow | null; solUsd: number | null; busy: boolean; onClose: () => void }) {
  const pnl = holding?.pnlSol ?? null;
  const tone = pnl != null && pnl < 0 ? "loss" : pnl != null && pnl > 0 ? "gain" : "";
  const tokenTone = position.tokenPct !== null && position.tokenPct < 0 ? "loss" : position.tokenPct !== null && position.tokenPct > 0 ? "gain" : "";
  return (
    <tr className="border-b border-border/60 hover:bg-secondary/40">
      <td className="px-3 py-2">
        <p className="font-semibold">{position.name}</p>
        <p className="text-[11px] text-muted-foreground">{position.address.slice(0, 4)}…{position.address.slice(-4)}</p>
      </td>
      <td className="px-3 py-2">{sol(position.stakeSol)}</td>
      <td className="px-3 py-2">
        <p>{holding ? sol(holding.valueSol) : "—"}</p>
        <p className="text-[11px] text-muted-foreground">
          {holding && solUsd != null ? money(holding.valueSol * solUsd) : "—"}
          {holding?.share != null ? ` · ${(holding.share * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })}%` : ""}
        </p>
      </td>
      <td className={`px-3 py-2 ${tokenTone}`}>{pct(position.tokenPct)}</td>
      <td className={`px-3 py-2 ${tone}`}>
        <p className={tone === "loss" ? "glow-red" : tone === "gain" ? "glow" : ""}>
          {pnl != null && pnl > 0 ? "▲ " : pnl != null && pnl < 0 ? "▼ " : ""}
          {pct(position.positionPct)}
        </p>
        <p className="text-[11px]">{pnl == null ? "—" : `${signedSol(pnl)} · ${solUsd == null ? "—" : signedMoney(pnl * solUsd)}`}</p>
      </td>
      <td className="px-3 py-2">{hoursOpen(position.openedAt)}</td>
      <td className="px-3 py-2 font-sans text-xs text-muted-foreground">{position.note || (position.closing ? "Cerrando." : "Abierta.")}</td>
      <td className="px-3 py-2 text-right">
        <Button type="button" variant="destructive" className="min-h-9 border border-destructive/60 font-bold" disabled={busy || position.closing} onClick={onClose}>
          {position.closing ? "[CERRANDO]" : "[CLOSE]"}
        </Button>
      </td>
    </tr>
  );
}

const REASON: Record<string, string> = {
  "take-profit": "toma",
  loss: "stop",
  time: "tiempo",
  rug: "caída brusca",
  gone: "ya no estaba",
  stop: "STOP",
  manual: "manual",
  above: "reabrir (regla antigua)",
};

function duration(ms: number): string {
  const hours = Math.max(0, ms / 3_600_000);
  return hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toLocaleString("es-ES", { maximumFractionDigits: 1 })} h`;
}

/** Closed positions with the result of the last on-chain read before each close. */
function HistoryPanel({ history, solUsd }: { history: ClosedPosition[]; solUsd: number | null }) {
  const known = history.filter((row) => row.resultSol != null);
  const total = known.reduce((sum, row) => sum + (row.resultSol ?? 0), 0);
  const wins = known.filter((row) => (row.resultSol ?? 0) > 0).length;
  const tone = total > 0 ? "gain glow" : total < 0 ? "loss glow-red" : "";
  const rows = [...history].reverse().slice(0, 50);
  return (
    <Panel title="history" right={`${history.length} cerradas`}>
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-3">
        <div className="bg-black px-3 py-2">
          <p className="text-[11px] tracking-widest text-muted-foreground">&gt; resultado_total</p>
          <p className={`num mt-1 text-lg font-semibold ${tone}`}>{known.length ? signedSol(total) : "—"}</p>
          <p className="text-xs text-muted-foreground">{known.length && solUsd != null ? signedMoney(total * solUsd) : "Sin cierres con lectura"}</p>
        </div>
        <div className="bg-black px-3 py-2">
          <p className="text-[11px] tracking-widest text-muted-foreground">&gt; ganadoras</p>
          <p className="num mt-1 text-lg font-semibold">{known.length ? `${wins} / ${known.length}` : "—"}</p>
          <p className="text-xs text-muted-foreground">{known.length ? `${Math.round((wins / known.length) * 100)}% de las cerradas` : "—"}</p>
        </div>
        <div className="col-span-2 bg-black px-3 py-2 sm:col-span-1">
          <p className="text-[11px] tracking-widest text-muted-foreground">&gt; cómo se mide</p>
          <p className="mt-1 text-xs text-muted-foreground">Última lectura en la cadena antes de cerrar, con comisiones. No incluye el alquiler (vuelve al cerrar) ni el costo de vender el token sobrante.</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">-- todavía no hay posiciones cerradas --</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[760px] text-left text-sm">
            <thead className="text-[11px] tracking-wider text-muted-foreground uppercase">
              <tr className="border-b border-border">
                <th className="px-3 py-2 font-medium">Pool</th>
                <th className="px-3 py-2 font-medium">Tamaño</th>
                <th className="px-3 py-2 font-medium">Resultado</th>
                <th className="px-3 py-2 font-medium">Motivo</th>
                <th className="px-3 py-2 font-medium">Duró</th>
                <th className="px-3 py-2 font-medium">Cerrada</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rowTone = row.resultSol == null ? "" : row.resultSol > 0 ? "gain" : row.resultSol < 0 ? "loss" : "";
                return (
                  <tr key={`${row.pool}-${row.closedAt}`} className="border-b border-border/60">
                    <td className="px-3 py-2 font-semibold">{row.name}</td>
                    <td className="px-3 py-2">{sol(row.stakeSol)}</td>
                    <td className={`px-3 py-2 ${rowTone}`}>
                      {row.resultSol == null ? "—" : `${pct(row.positionPct)} · ${signedSol(row.resultSol)}`}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{REASON[row.reason] ?? row.reason}</td>
                    <td className="px-3 py-2">{duration(row.closedAt - row.openedAt)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.signature ? (
                        <a className="hover:underline" href={`https://solscan.io/tx/${row.signature}`} target="_blank" rel="noreferrer">
                          {new Date(row.closedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })} ↗
                        </a>
                      ) : (
                        new Date(row.closedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function StatePill({ state }: { state: "BOOTING" | "RUNNING" | "STOPPED" | "KILL" }) {
  const tone =
    state === "RUNNING" ? "border-primary text-primary glow" : state === "KILL" ? "border-destructive text-destructive glow-red" : state === "STOPPED" ? "border-warn text-warn" : "border-border text-muted-foreground";
  return (
    <span className={`num inline-flex items-center gap-2 border px-2 py-0.5 text-xs font-bold tracking-widest ${tone}`}>
      <span className={`size-2 ${state === "RUNNING" ? "animate-pulse bg-primary" : state === "KILL" ? "bg-destructive" : state === "STOPPED" ? "bg-warn" : "bg-muted-foreground"}`} />
      {state}
    </span>
  );
}

function Panel({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-border bg-black/80">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/30 px-3 py-1.5 text-xs">
        <h2 className="font-bold tracking-widest">┌─[ {title} ]</h2>
        {typeof right === "string" ? <span className="text-muted-foreground">{right}</span> : right}
      </div>
      {children}
    </section>
  );
}

function BinRange({ rangePct }: { rangePct: number }) {
  // 40 bins across the chart; Bid-Ask stacks more SOL toward the bottom of the range.
  const bins = 40;
  const used = Math.round((Math.min(100, Math.max(8, rangePct)) / 100) * bins);
  return (
    <div className="flex h-12 items-end gap-px border border-border bg-black px-1 pt-1" aria-hidden="true">
      {Array.from({ length: bins }, (_, i) => {
        const inside = i >= bins - used;
        const depth = inside ? (bins - i) / used : 0;
        return <div key={i} className={inside ? "flex-1 bg-primary/70" : "flex-1 bg-secondary/40"} style={{ height: inside ? `${20 + depth * 80}%` : "8%" }} />;
      })}
      <div className="ml-1 h-full w-px bg-foreground" />
    </div>
  );
}

function Metric({ k, v, hint }: { k: string; v: string; hint: string }) {
  return (
    <div className="border border-border bg-black/80 px-3 py-2">
      <p className="text-[11px] tracking-widest text-muted-foreground">&gt; {k}</p>
      <p className="num glow mt-1 text-xl font-semibold">{v}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function Readout({ k, v, text }: { k: string; v: string; text: string }) {
  return (
    <div className="bg-black px-3 py-3">
      <p className="text-[11px] tracking-widest text-muted-foreground">&gt; {k}</p>
      <p className="mt-1 font-semibold">{v}</p>
      <p className="mt-1 text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 border border-border p-3">
      <legend className="px-1 text-[11px] font-bold tracking-widest">[ {title} ]</legend>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  hint,
  suffix,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  suffix: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <Input className="num h-10 bg-black" inputMode="decimal" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
        <span className="w-8 shrink-0 text-xs text-muted-foreground">{suffix}</span>
      </span>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </label>
  );
}
