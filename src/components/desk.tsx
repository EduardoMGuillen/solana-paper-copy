"use client";

import { useEffect, useState } from "react";
import { OctagonX, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LineChart, Sparkline } from "@/components/charts";
import type { DeskView } from "@/lib/engine/view";
import type { RiskSettings } from "@/lib/engine/types";

function money(value: number, signed = false): string {
  const body = value.toLocaleString("es-ES", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (signed && value > 0) return `+${body}`;
  return body;
}

function factor(value: number | null): string {
  if (value === null) return "—";
  if (!Number.isFinite(value)) return "∞";
  return value.toLocaleString("es-ES", { maximumFractionDigits: 2 });
}

function pct(value: number | null): string {
  if (value === null) return "—";
  if (!Number.isFinite(value)) return "∞";
  return `${(value * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })}%`;
}

function usd(value: number): string {
  return value.toLocaleString("es-ES", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function tone(value: number): string {
  if (value > 0) return "gain";
  if (value < 0) return "loss";
  return "text-muted-foreground";
}

function clock(ts: number | null): string {
  if (!ts) return "aún no";
  return new Date(ts).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  });
}

async function post(body: unknown): Promise<{ ok: boolean; error?: string; view?: DeskView }> {
  const response = await fetch("/api/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

export function Desk({ initialView = null }: { initialView?: DeskView | null }) {
  const [view, setView] = useState<DeskView | null>(initialView);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [wallet, setWallet] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RiskSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) throw new Error("estado");
        const next = (await response.json()) as DeskView;
        if (stop) return;
        setView(next);
        setError(null);
      } catch {
        if (!stop) setError("No se pudo leer el motor. Se reintenta solo.");
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  const settings = dirty && draft ? draft : view?.settings ?? null;

  function edit(key: keyof RiskSettings, value: number) {
    if (!Number.isFinite(value) || !view) return;
    setDirty(true);
    setDraft((current) => ({ ...(current ?? view.settings), [key]: value }));
  }

  async function act(key: string, body: unknown) {
    setBusy(key);
    setFormError(null);
    try {
      const result = await post(body);
      if (result.view) setView(result.view);
      if (!result.ok) setFormError(result.error ?? "No se pudo aplicar.");
      else {
        setDirty(false);
        setDraft(null);
      }
    } catch {
      setFormError("La mesa no respondió.");
    } finally {
      setBusy(null);
    }
  }

  const meteora = (view?.leaders ?? [])
    .filter((leader) => leader.kind === "meteora" && leader.listed)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const demo = (view?.leaders ?? []).filter((leader) => leader.kind === "demo");
  const extra = (view?.leaders ?? []).filter(
    (leader) => leader.kind === "wallet" || (leader.kind === "meteora" && !leader.listed),
  );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6">
      <header className="sticky top-0 z-20 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs tracking-[0.18em] text-muted-foreground uppercase">Solana · solo papel</p>
            <h1 className="text-2xl font-semibold tracking-tight">Mesa de copia</h1>
            <p className="max-w-xl text-sm text-muted-foreground">{view?.disclaimer ?? "Los resultados en papel no son beneficios reales."}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
            <Tape label="Patrimonio" value={view ? money(view.account.equity) : "—"} />
            <Tape label="Realizado" value={view ? money(view.account.realized, true) : "—"} className={view ? tone(view.account.realized) : ""} />
            <Tape label="No realizado" value={view ? money(view.account.unrealized, true) : "—"} className={view ? tone(view.account.unrealized) : ""} />
            <Tape label="Hoy" value={view ? money(view.account.dayPnl, true) : "—"} className={view ? tone(view.account.dayPnl) : ""} />
          </div>
          <Button
            type="button"
            variant={view?.kill.active ? "secondary" : "destructive"}
            className="min-h-11 cursor-pointer px-4"
            disabled={!view || busy === "kill"}
            aria-pressed={view?.kill.active ?? false}
            onClick={() => view && void act("kill", { type: "kill", active: !view.kill.active })}
          >
            <OctagonX aria-hidden="true" />
            {view?.kill.active ? "Reanudar copias" : "Cortar copias"}
          </Button>
        </div>
        <p className="mt-2 min-h-5 text-sm text-muted-foreground" aria-live="polite">
          {view?.kill.reason
            ? view.kill.reason
            : view
              ? `Pérdida realizada hoy ${money(view.kill.realizedToday, true)} · límite −${money(view.kill.limit)}`
              : "Cargando la mesa…"}
        </p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </header>

      {!view ? <Skeleton /> : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Efectividad sobre los 100 US$</CardTitle>
              <CardDescription>
                La cuenta empieza en 100 US$. Solo abre y gestiona copias mientras este proceso está en marcha. No hay un operador en segundo plano. Al parar la mesa se cierran todas las posiciones al último precio, con comisión y deslizamiento, y después se escribe el dataset.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat k="Inicio" v={money(view.effectiveness.startingEquity)} />
                <Stat k="Retorno" v={pct(view.effectiveness.totalReturn)} />
                <Stat k="Acierto" v={pct(view.effectiveness.winRate)} />
                <Stat k="Factor" v={view.effectiveness.profitFactorUnbounded ? "∞" : factor(view.effectiveness.profitFactor)} />
                <Stat k="Drawdown" v={pct(view.effectiveness.maxDrawdown)} />
                <Stat k="Cierres" v={String(view.effectiveness.closed)} />
              </dl>
              <p className="text-sm text-muted-foreground">
                {view.effectiveness.session
                  ? view.effectiveness.session.stop
                    ? `Sesión ${clock(view.effectiveness.session.start)} – ${clock(view.effectiveness.session.stop)} UTC.`
                    : `Sesión iniciada a las ${clock(view.effectiveness.session.start)} UTC. Sigue abierta.`
                  : "Todavía no hay una sesión guardada."}
                {" "}Dataset en {view.effectiveness.path}. {view.effectiveness.tradeCount} operaciones.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Top 7 de Meteora</CardTitle>
              <CardDescription>
                {view.meteora.sourceName}. {view.meteora.ranksWhat}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                Ventana: {view.meteora.windowLabel}.
                {view.meteora.vaultLabel ? ` Vault: ${view.meteora.vaultLabel}.` : ""}
                {" "}Último refresco: {clock(view.meteora.refreshedAt)}.
              </p>
              {view.meteora.error ? (
                <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="status">
                  {view.meteora.error}
                </p>
              ) : null}
              {meteora.length === 0 ? (
                <p className="min-h-40 text-sm text-muted-foreground">
                  Fuente no disponible. No hay direcciones que mostrar. Lumen, Ráfaga y Fosa siguen operando en papel.
                </p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {meteora.map((leader) => (
                    <li key={leader.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-background/50 px-3 py-2">
                      <span className="num w-6 text-lg text-primary">{leader.rank}</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{leader.name}</p>
                        <p className="num truncate text-xs text-muted-foreground">{leader.wallet}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Stake {leader.publishedStake?.toLocaleString("es-ES", { maximumFractionDigits: 0 }) ?? "—"}
                          {" · "}recompensa {leader.publishedRewardUsd === null ? "—" : usd(leader.publishedRewardUsd)}
                          {" · "}PnL papel <span className={tone(leader.copiedPnl)}>{money(leader.copiedPnl, true)}</span>
                        </p>
                      </div>
                      <CopySwitch
                        leader={leader}
                        busy={busy === leader.id}
                        onChange={(enabled) => void act(leader.id, { type: "toggle", id: leader.id, enabled })}
                      />
                    </li>
                  ))}
                </ol>
              )}
              <Separator />
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void act("wallet", { type: "add-wallet", wallet });
                }}
              >
                <Label htmlFor="wallet" className="sr-only">Vigilar otra wallet</Label>
                <Input
                  id="wallet"
                  value={wallet}
                  onChange={(event) => setWallet(event.target.value)}
                  placeholder="Vigilar otra wallet de mainnet"
                  className="min-h-11"
                  spellCheck={false}
                />
                <Button type="submit" variant="outline" className="min-h-11 cursor-pointer" disabled={busy === "wallet"}>
                  Vigilar
                </Button>
              </form>
              {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Curva de patrimonio</CardTitle>
                <CardDescription>Marcada a mercado con comisión y deslizamiento de salida.</CardDescription>
              </CardHeader>
              <CardContent>
                <LineChart
                  points={view.equityCurve}
                  getY={(point) => point.equity}
                  label="Patrimonio en papel"
                  summary={view.account.equitySummary}
                  stroke={view.account.equity >= view.account.startingEquity ? "#22C55E" : "#EF4444"}
                  baseline={view.account.startingEquity}
                  baselineLabel="inicio"
                  formatY={(value) => money(value)}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Drawdown de la cuenta</CardTitle>
                <CardDescription>Caída desde el máximo del patrimonio en papel. El número va junto al color.</CardDescription>
              </CardHeader>
              <CardContent>
                <LineChart
                  points={view.drawdownCurve}
                  getY={(point) => -point.drawdown * 100}
                  label={`Máximo ${pct(view.account.maxDrawdown)}`}
                  summary={view.account.drawdownSummary}
                  stroke="#EF4444"
                  baseline={0}
                  baselineLabel="0%"
                  formatY={(value) => `${value.toFixed(1)}%`}
                />
              </CardContent>
            </Card>
          </div>

          <section className="grid gap-3 lg:col-span-2 md:grid-cols-3">
            {demo.map((leader) => (
              <Card key={leader.id} size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    {leader.name}
                    <Badge variant={leader.status.code === "copying" ? "default" : leader.status.code === "paused" ? "destructive" : "outline"}>
                      {leader.status.label}
                    </Badge>
                  </CardTitle>
                  <CardDescription>{leader.note}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <Sparkline points={leader.series} label={leader.name} />
                    <p className={`num text-sm ${tone(leader.copiedPnl)}`}>{money(leader.copiedPnl, true)}</p>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-xs">
                    <Stat k="Acierto" v={pct(leader.winRate)} />
                    <Stat k="Factor" v={factor(leader.profitFactor)} />
                    <Stat k="Drawdown" v={pct(leader.maxDrawdown)} />
                  </dl>
                  <CopySwitch
                    leader={leader}
                    busy={busy === leader.id}
                    onChange={(enabled) => void act(leader.id, { type: "toggle", id: leader.id, enabled })}
                  />
                </CardContent>
              </Card>
            ))}
          </section>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Posiciones abiertas</CardTitle>
              <CardDescription>El stop cierra la copia si el líder no vende.</CardDescription>
            </CardHeader>
            <CardContent className="min-h-28">
              {view.positions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin copias abiertas.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Líder</TableHead>
                      <TableHead>Token</TableHead>
                      <TableHead>Entrada</TableHead>
                      <TableHead>Marca</TableHead>
                      <TableHead>Stop</TableHead>
                      <TableHead>PnL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.positions.map((position) => (
                      <TableRow key={position.id}>
                        <TableCell>{position.leaderName}</TableCell>
                        <TableCell className="num">{position.symbol}</TableCell>
                        <TableCell className="num">{position.entryPrice.toPrecision(3)}</TableCell>
                        <TableCell className="num">{position.mark.toPrecision(3)}</TableCell>
                        <TableCell className="num">{position.stopPrice.toPrecision(3)}</TableCell>
                        <TableCell className={`num ${tone(position.unrealized)}`}>{money(position.unrealized, true)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Historial</CardTitle>
            </CardHeader>
            <CardContent className="max-h-80 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hora</TableHead>
                    <TableHead>Qué</TableHead>
                    <TableHead>PnL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.trades.map((trade) => (
                    <TableRow key={trade.id}>
                      <TableCell className="num text-xs">{clock(trade.ts)}</TableCell>
                      <TableCell>
                        {trade.reasonLabel} {trade.symbol}
                        <span className="block text-xs text-muted-foreground">{trade.leaderName} · comisión {trade.feeSol.toFixed(4)}</span>
                      </TableCell>
                      <TableCell className={`num ${tone(trade.pnlSol ?? 0)}`}>
                        {trade.pnlSol === null ? "—" : money(trade.pnlSol, true)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Señales omitidas</CardTitle>
              <CardDescription>Una copia tiene que pasar todas las reglas.</CardDescription>
            </CardHeader>
            <CardContent className="max-h-80 overflow-auto text-sm">
              {view.skips.length === 0 ? (
                <p className="text-muted-foreground">Ninguna señal rechazada en esta ventana.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {view.skips.map((skip) => (
                    <li key={skip.id}>
                      <span className="text-muted-foreground">{clock(skip.ts)} · {skip.leaderName} · {skip.symbol}</span>
                      <span className="block">{skip.reasons.join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              )}
              {extra.length > 0 ? (
                <div className="mt-4 flex flex-col gap-2">
                  <p className="text-xs tracking-wide text-muted-foreground uppercase">Otras wallets</p>
                  {extra.map((leader) => (
                    <div key={leader.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-xs">{leader.name} {leader.wallet ? `· ${leader.wallet.slice(0, 4)}…${leader.wallet.slice(-4)}` : ""}</span>
                      <div className="flex items-center gap-2">
                        <CopySwitch leader={leader} busy={busy === leader.id} onChange={(enabled) => void act(leader.id, { type: "toggle", id: leader.id, enabled })} />
                        <Button type="button" variant="ghost" size="sm" className="cursor-pointer" onClick={() => void act(leader.id, { type: "remove", id: leader.id })}>
                          Quitar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <details className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10 lg:col-span-2">
            <summary className="min-h-11 cursor-pointer text-sm font-medium">Ajustes de riesgo</summary>
            {settings ? (
              <form
                className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void act("settings", { type: "settings", settings });
                }}
              >
                <Field label="Fracción del patrimonio" suffix="%" value={settings.fraction * 100} onChange={(value) => edit("fraction", value / 100)} />
                <Field label="Tope de la fracción" suffix="%" value={settings.fractionCap * 100} onChange={(value) => edit("fractionCap", value / 100)} />
                <Field label="Mínimo por operación" suffix="US$" value={settings.minSol} onChange={(value) => edit("minSol", value)} />
                <Field label="Antigüedad máxima" suffix="s" value={settings.maxSignalAgeMs / 1000} onChange={(value) => edit("maxSignalAgeMs", value * 1000)} />
                <Field label="Deriva máxima" suffix="%" value={settings.maxPriceDriftBps / 100} onChange={(value) => edit("maxPriceDriftBps", value * 100)} />
                <Field label="Capital por líder" suffix="US$" value={settings.leaderCapitalCapSol} onChange={(value) => edit("leaderCapitalCapSol", value)} />
                <Field label="Drawdown para pausar" suffix="%" value={settings.leaderDrawdownPause * 100} onChange={(value) => edit("leaderDrawdownPause", value / 100)} />
                <Field label="Enfriamiento del token" suffix="s" value={settings.mintCooldownMs / 1000} onChange={(value) => edit("mintCooldownMs", value * 1000)} />
                <Field label="Pérdida diaria máxima" suffix="US$" value={settings.dailyLossKillSol} onChange={(value) => edit("dailyLossKillSol", value)} />
                <Field label="Stop de protección" suffix="%" value={settings.protectiveStopPct * 100} onChange={(value) => edit("protectiveStopPct", value / 100)} />
                <Field label="Comisión" suffix="%" value={settings.feeBps / 100} onChange={(value) => edit("feeBps", value * 100)} />
                <Field label="Deslizamiento" suffix="%" value={settings.slippageBps / 100} onChange={(value) => edit("slippageBps", value * 100)} />
                <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
                  <Button type="submit" className="min-h-11 cursor-pointer" disabled={busy === "settings"}>Guardar ajustes</Button>
                  {confirmReset ? (
                    <Button type="button" variant="destructive" className="min-h-11 cursor-pointer" onClick={() => void act("reset", { type: "reset" })}>
                      <RotateCcw aria-hidden="true" /> Confirmar reinicio
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" className="min-h-11 cursor-pointer" onClick={() => setConfirmReset(true)}>
                      Reiniciar cuenta de papel
                    </Button>
                  )}
                </div>
              </form>
            ) : null}
          </details>
        </div>
      )}
    </main>
  );
}

function Tape({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-24">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`num min-h-6 text-sm transition-colors duration-200 ${className}`}>{value}</p>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="num">{v}</dd>
    </div>
  );
}

function CopySwitch({
  leader,
  busy,
  onChange,
}: {
  leader: { id: string; name: string; enabled: boolean };
  busy: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <Label htmlFor={`copy-${leader.id}`} className="min-h-11 cursor-pointer gap-2 text-xs">
      <Switch
        id={`copy-${leader.id}`}
        checked={leader.enabled}
        disabled={busy}
        onCheckedChange={(checked) => onChange(Boolean(checked))}
        aria-label={leader.enabled ? `Dejar de copiar a ${leader.name}` : `Copiar operaciones de ${leader.name}`}
      />
      {leader.enabled ? "Copiando" : "Observación"}
    </Label>
  );
}

function Field({
  label,
  suffix,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = label.replace(/\s+/g, "-").toLowerCase();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          className="num min-h-11"
          inputMode="decimal"
          value={Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : ""}
          onChange={(event) => onChange(Number(event.target.value.replace(",", ".")))}
        />
        <span className="w-10 text-xs text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}


function Skeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]" aria-busy="true" aria-live="polite">
      <div className="min-h-[28rem] rounded-xl bg-card ring-1 ring-foreground/10" />
      <div className="flex flex-col gap-4">
        <div className="min-h-52 rounded-xl bg-card ring-1 ring-foreground/10" />
        <div className="min-h-52 rounded-xl bg-card ring-1 ring-foreground/10" />
      </div>
      <p className="text-sm text-muted-foreground lg:col-span-2">Cargando líderes, curvas y posiciones.</p>
    </div>
  );
}
