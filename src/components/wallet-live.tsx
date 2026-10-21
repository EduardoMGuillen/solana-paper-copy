"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DeskNav } from "@/components/nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LivePosition } from "@/lib/exec/live-book";
import { LIVE_PRESETS, sameLiveParams, type LiveParams } from "@/lib/exec/live-params";
import type { WalletStatus } from "@/lib/exec/wallet";

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
  const numbers = [slot, minTvl, minFees24h, minBaseFeePct, minVolume1h, takeProfit, stopLoss, holdHours, range, binStep];
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
  }, []);

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
  const inPools = openPositions.reduce((sum, position) => sum + (position.closing ? 0 : position.stakeSol), 0);
  const locked = !status || running || status.kill;
  const address = status?.address ?? null;
  const params = status?.params;
  const draft = form ? payloadFrom(form) : null;
  const activePreset = draft ? (LIVE_PRESETS.find((preset) => sameLiveParams(draft, preset.params))?.id ?? null) : null;
  const rangePct = params ? params.range * 100 : 75;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6">
      <DeskNav />

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#070b14] shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <div className="h-px bg-gradient-to-r from-transparent via-emerald-400/80 to-transparent" />

        <header className="flex flex-col gap-4 border-b border-white/10 px-4 py-4 sm:px-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] tracking-[0.22em] text-emerald-300/80 uppercase">Solana · DLMM · Bid-Ask</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">Meteora live</h1>
              <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs ${running ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-400/10 text-amber-200"}`}>
                <span className={`size-1.5 rounded-full ${running ? "animate-pulse bg-emerald-400" : "bg-amber-300"}`} />
                {status ? (running ? "Encendido" : "Apagado") : "Leyendo"}
              </span>
            </div>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Liquidez solo en SOL, por debajo del precio. El papel de Estrategia y el de Meteora siguen en sus páginas.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" className="min-h-11 cursor-pointer px-5" disabled={!status || busy || running || status.kill} aria-pressed={running} onClick={() => void post({ running: true })}>
              Start
            </Button>
            <Button type="button" variant="destructive" className="min-h-11 cursor-pointer px-5" disabled={!status || busy || (!running && (status.positions?.length ?? 0) === 0)} aria-pressed={!running} onClick={() => void post({ running: false })}>
              Stop
            </Button>
          </div>
        </header>
        <p className="border-b border-white/10 px-4 py-2 text-sm text-muted-foreground sm:px-5">
          {status?.notice ?? "Start abre posiciones reales con esta wallet. Stop las cierra todas. Cada fila se puede cerrar sola."}
          {status?.balanceSol === 0 ? " La wallet está en 0 SOL: no se abre nada y no se envía ninguna transacción." : ""}
        </p>

        <div className="grid grid-cols-2 divide-x divide-y divide-white/10 border-b border-white/10 md:grid-cols-4 md:divide-y-0">
          <Metric k="Wallet" v={status?.balanceSol == null ? "—" : sol(status.balanceSol)} hint={status?.balanceUsd == null ? (status?.balanceSol === 0 ? "Sin fondos" : "Saldo on-chain") : money(status.balanceUsd)} />
          <Metric k="En pools" v={sol(inPools)} hint={inPools === 0 ? "Sin liquidez puesta" : "SOL en posiciones abiertas"} />
          <Metric k="Libre" v={status?.balanceSol == null ? "—" : sol(Math.max(0, status.balanceSol - inPools))} hint="Saldo que no está en un pool" />
          <Metric k="Posiciones" v={String(openPositions.length)} hint={params ? `Cada nueva usa el ${plain(params.slot * 100, 0)}%` : "—"} />
        </div>

        <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Dirección</p>
            <p className="num truncate text-sm">{address ?? "—"}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 shrink-0 cursor-pointer"
            disabled={!address}
            onClick={() => {
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
            }}
          >
            {copied ? "Copiada" : copyFailed ? "No se pudo copiar" : "Copiar"}
          </Button>
        </div>

        {error ? <p className="px-5 py-3 text-sm text-destructive">{error}</p> : null}
        {actionError ? <p className="px-5 py-3 text-sm text-destructive">{actionError}</p> : null}
        {status?.error ? <p className="px-5 pb-3 text-sm text-destructive">{status.error}</p> : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#070b14]">
        <div className="flex items-end justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
          <div>
            <p className="text-[11px] tracking-[0.18em] text-muted-foreground uppercase">Libro</p>
            <h2 className="text-lg font-semibold">Posiciones abiertas</h2>
          </div>
          <p className="text-xs text-muted-foreground">{running ? "Encendido" : "Apagado"} · {status?.positions.length ?? 0} abiertas</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-[11px] tracking-wide text-muted-foreground uppercase">
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 font-medium sm:px-5">Pool</th>
                <th className="px-3 py-3 font-medium">Tamaño</th>
                <th className="px-3 py-3 font-medium">Token</th>
                <th className="px-3 py-3 font-medium">Posición</th>
                <th className="px-3 py-3 font-medium">Comisión</th>
                <th className="px-3 py-3 font-medium">Tiempo</th>
                <th className="px-4 py-3 font-medium sm:px-5">Qué pasa</th>
                <th className="px-4 py-3 font-medium sm:px-5">Cerrar</th>
              </tr>
            </thead>
            <tbody>
              {(status?.positions.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 sm:px-5">
                    <p className="text-base font-medium">Sin posiciones abiertas</p>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                      {running
                        ? status?.balanceSol === 0
                          ? "El bot está encendido y la wallet sigue en 0 SOL. No hay liquidez que poner en un pool."
                          : "El bot está encendido. Todavía no hay una posición abierta."
                        : "El bot está apagado. Start es el que empieza a abrir."}
                    </p>
                  </td>
                </tr>
              ) : (
                status?.positions.map((position) => (
                  <PositionRow key={position.address} position={position} busy={busy} onClose={() => void post({ close: position.address })} />
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="grid gap-px border-t border-white/10 bg-white/10 sm:grid-cols-3">
          <Readout
            k="Token"
            v="Precio contra la entrada"
            text="Si el token sube, el SOL sigue quieto debajo del precio. La fila se queda plana."
          />
          <Readout
            k="Posición"
            v="Lo que le pasa al SOL"
            text="Suma la marca de la liquidez y las comisiones. No es el mismo porcentaje que el token."
          />
          <Readout
            k="Salida"
            v={params ? `+${plain(params.takeProfit * 100, 0)}% · −${plain(params.stopLoss * 100, 0)}% · ${plain(params.holdHours, 0)} h` : "—"}
            text="Cierra al llegar a la toma, al stop o al cumplirse el tiempo."
          />
        </div>

        <div className="px-4 py-4 sm:px-5">
          <div className="mb-2 flex items-center justify-between text-[11px] tracking-wide text-muted-foreground uppercase">
            <span>Rango Bid-Ask</span>
            <span className="num">−{plain(rangePct, 0)}% → entrada</span>
          </div>
          <div className="relative h-10 overflow-hidden rounded-lg bg-white/5">
            <div className="absolute inset-y-1 right-0 rounded-md bg-gradient-to-l from-emerald-400/50 to-emerald-400/10" style={{ width: `${Math.min(100, Math.max(8, rangePct))}%` }} />
            <div className="absolute inset-y-0 right-0 w-px bg-white" />
            <div className="absolute inset-0 flex items-center justify-between px-3 text-[11px]">
              <span className="text-emerald-100/80">SOL en los bins de abajo</span>
              <span>Entrada</span>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            El precio tiene que bajar de la entrada para que el SOL empiece a convertirse en el token. Mientras esté arriba, la posición ni gana ni pierde por el precio.
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#070b14]">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left sm:px-5"
          aria-expanded={configOpen}
          onClick={() => setConfigOpen((open) => !open)}
        >
          <span>
            <span className="block text-[11px] tracking-[0.18em] text-muted-foreground uppercase">Configuración</span>
            <span className="block text-lg font-semibold">Parámetros</span>
            <span className="block max-w-2xl text-sm text-muted-foreground">
              {dirty
                ? "Hay cambios sin guardar."
                : params
                  ? `${plain(params.slot * 100, 0)}% por posición · +${plain(params.takeProfit * 100, 0)}% / −${plain(params.stopLoss * 100, 0)}% / ${plain(params.holdHours, 0)} h`
                  : "Leyendo los parámetros…"}
            </span>
          </span>
          <span className="shrink-0 text-sm text-muted-foreground">{configOpen ? "Ocultar" : "Mostrar"}</span>
        </button>

        {configOpen ? (
        <div>
        <div className="flex flex-col gap-3 border-t border-white/10 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
          <p className="max-w-2xl text-sm text-muted-foreground">
            {!status
              ? "Leyendo los parámetros…"
              : locked
                ? "Bloqueados con el bot encendido. Stop los deja editables."
                : "El perfil Papel es el que usa Meteora papel ahora. Guardar no enciende el bot."}
          </p>
          <div className="flex flex-wrap gap-2">
            {LIVE_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant={activePreset === preset.id ? "default" : "outline"}
                className="min-h-11 cursor-pointer"
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
            className="flex flex-col gap-5 px-4 py-4 sm:px-5"
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
            <div className="grid gap-4 md:grid-cols-3">
              <Group title="Tamaño">
                <Field label="Por posición" suffix="%" value={form.slotPct} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "slotPct", value)} hint="Del SOL de esta wallet. El papel usa 10." />
              </Group>
              <Group title="Entrada">
                <Field label="TVL mínimo" suffix="US$" value={form.minTvl} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "minTvl", value)} hint="Liquidez del pool." />
                <Field label="Comisiones 24 h" suffix="US$" value={form.minFees24h} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "minFees24h", value)} hint="Lo que el pool cobró en un día." />
                <Field label="Comisión base" suffix="%" value={form.minBaseFeePct} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "minBaseFeePct", value)} hint="Fee del pool. El papel pide 1." />
                <Field label="Volumen 1 h" suffix="US$" value={form.minVolume1h} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "minVolume1h", value)} hint="Operación reciente del pool." />
              </Group>
              <Group title="Salida y rango">
                <Field label="Toma de ganancia" suffix="%" value={form.takeProfitPct} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "takeProfitPct", value)} hint="Cierra la posición al llegar aquí." />
                <Field label="Stop" suffix="%" value={form.stopLossPct} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "stopLossPct", value)} hint="Cierra si la posición cae esto." />
                <Field label="Tiempo máximo" suffix="h" value={form.holdHours} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "holdHours", value)} hint="Cierra aunque no haya toma ni stop." />
                <Field label="Rango bajo la entrada" suffix="%" value={form.rangePct} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "rangePct", value)} hint="Hasta dónde se reparte el SOL." />
                <Field label="Ancho de bin" suffix="%" value={form.binStepPct} disabled={locked} onChange={(value) => setField(setForm, markDirty, setSaved, "binStepPct", value)} hint="Separación entre bins." />
              </Group>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" className="min-h-11 cursor-pointer px-5" disabled={locked || busy || !dirty}>
                Guardar parámetros
              </Button>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {saved ? "Guardado." : dirty ? "Hay cambios sin guardar." : `TVL ${params ? usd(params.minTvl) : "—"} · fee 24 h ${params ? usd(params.minFees24h) : "—"}.`}
              </p>
            </div>
          </form>
        ) : (
          <p className="px-5 py-6 text-sm text-muted-foreground">Leyendo los parámetros…</p>
        )}
        </div>
        ) : null}
      </section>
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

function PositionRow({ position, busy, onClose }: { position: LivePosition; busy: boolean; onClose: () => void }) {
  return (
    <tr className="border-b border-white/10">
      <td className="px-4 py-3 sm:px-5">
        <p className="font-medium">{position.name}</p>
        <p className="num text-[11px] text-muted-foreground">{position.address.slice(0, 4)}…{position.address.slice(-4)}</p>
      </td>
      <td className="num px-3 py-3">{sol(position.stakeSol)}</td>
      <td className={`num px-3 py-3 ${position.tokenPct !== null && position.tokenPct < 0 ? "loss" : position.tokenPct !== null && position.tokenPct > 0 ? "gain" : ""}`}>{pct(position.tokenPct)}</td>
      <td className={`num px-3 py-3 ${position.positionPct !== null && position.positionPct < 0 ? "loss" : position.positionPct !== null && position.positionPct > 0 ? "gain" : ""}`}>{pct(position.positionPct)}</td>
      <td className="px-3 py-3 text-muted-foreground">—</td>
      <td className="num px-3 py-3">{hoursOpen(position.openedAt)}</td>
      <td className="px-4 py-3 text-sm text-muted-foreground sm:px-5">{position.note || (position.closing ? "Cerrando." : "Abierta.")}</td>
      <td className="px-4 py-3 sm:px-5">
        <Button type="button" variant="outline" className="min-h-11 cursor-pointer" disabled={busy || position.closing} onClick={onClose}>
          {position.closing ? "Cerrando" : "Cerrar"}
        </Button>
      </td>
    </tr>
  );
}

function Metric({ k, v, hint }: { k: string; v: string; hint: string }) {
  return (
    <div className="px-4 py-3 sm:px-5">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{k}</p>
      <p className="num mt-1 text-xl">{v}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function Readout({ k, v, text }: { k: string; v: string; text: string }) {
  return (
    <div className="bg-[#070b14] px-4 py-4 sm:px-5">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{k}</p>
      <p className="mt-1 font-medium">{v}</p>
      <p className="mt-1 text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-white/10 p-3">
      <legend className="px-1 text-[11px] tracking-wide text-muted-foreground uppercase">{title}</legend>
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
        <Input className="num h-11" inputMode="decimal" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
        <span className="w-8 shrink-0 text-xs text-muted-foreground">{suffix}</span>
      </span>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </label>
  );
}
