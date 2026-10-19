"use client";

import { useEffect, useState } from "react";
import { Pause, Play, RefreshCw, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CandleChart, LineChart } from "@/components/charts";
import type { BotView } from "@/lib/bot/view";
import type { BotSettings } from "@/lib/bot/settings";
import { MARKETS } from "@/lib/bot/market";

type MarketView = BotView["markets"][number];

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

function pct(value: number | null, signed = false): string {
  if (value === null) return "—";
  if (!Number.isFinite(value)) return "∞";
  const body = `${(value * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })}%`;
  return signed && value > 0 ? `+${body}` : body;
}

function price(value: number | null): string {
  if (value === null) return "—";
  return value >= 1 ? value.toLocaleString("es-ES", { maximumFractionDigits: 4 }) : value.toPrecision(4);
}

function tone(value: number): string {
  if (value > 0) return "gain";
  if (value < 0) return "loss";
  return "text-muted-foreground";
}

function when(ts: number | null): string {
  if (!ts) return "aún no";
  return new Date(ts).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function post(body: unknown): Promise<{ ok: boolean; error?: string; view?: BotView }> {
  const response = await fetch("/api/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

export function Desk({ initialView = null }: { initialView?: BotView | null }) {
  const [view, setView] = useState<BotView | null>(initialView);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [draft, setDraft] = useState<BotSettings | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) throw new Error("estado");
        const next = (await response.json()) as BotView;
        if (!stop) {
          setView(next);
          setError(null);
        }
      } catch {
        if (!stop) setError("No se pudo leer el bot. Se reintenta solo.");
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  const settings = draft ?? view?.settings ?? null;

  function edit<K extends keyof BotSettings>(key: K, value: BotSettings[K]) {
    if (!view) return;
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
        setDraft(null);
        setConfirmReset(false);
      }
    } catch {
      setFormError("El bot no respondió.");
    } finally {
      setBusy(null);
    }
  }

  const account = view?.account;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6">
      <header className="sticky top-0 z-20 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs tracking-[0.18em] text-muted-foreground uppercase">Solana · análisis técnico · papel</p>
            <h1 className="text-2xl font-semibold tracking-tight">Bot de estrategia</h1>
            <p className="max-w-xl text-sm text-muted-foreground">{view?.disclaimer ?? "Cargando…"}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-5">
            <Tape label="Patrimonio" value={account ? money(account.equity) : "—"} />
            <Tape label="Retorno" value={account ? pct(account.totalReturn, true) : "—"} className={account ? tone(account.totalReturn) : ""} />
            <Tape label="Realizado" value={account ? money(account.realized, true) : "—"} className={account ? tone(account.realized) : ""} />
            <Tape label="Hoy" value={account ? money(account.dayPnl, true) : "—"} className={account ? tone(account.dayPnl) : ""} />
            <Tape label="Abiertas" value={account ? String(account.open) : "—"} />
          </div>
          <Button
            type="button"
            variant={view?.halt.manual ? "secondary" : "destructive"}
            className="min-h-11 cursor-pointer px-4"
            disabled={!view || busy === "halt"}
            aria-pressed={view?.halt.manual ?? false}
            onClick={() => view && void act("halt", { type: "halt", active: !view.halt.active })}
          >
            {view?.halt.active ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            {view?.halt.active ? "Reanudar entradas" : "Pausar entradas"}
          </Button>
        </div>
        <p className="mt-2 min-h-5 text-sm text-muted-foreground" aria-live="polite">
          {view?.halt.reason ??
            (view
              ? `Operando ${view.markets.length} mercados en velas de ${view.settings.interval}. Decide al cierre de cada vela; el servidor sigue aunque cierres esta pestaña.`
              : "Cargando el bot…")}
        </p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </header>

      {!view || !account ? (
        <div className="min-h-[28rem] rounded-xl bg-card ring-1 ring-foreground/10" aria-busy="true" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Rendimiento sobre {money(account.startingEquity)}</CardTitle>
              <CardDescription>
                Cada operación paga comisión y deslizamiento. El tamaño se calcula por riesgo: si salta el stop inicial, se pierde el {pct(view.settings.riskPerTrade)} del capital de ese mercado.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                <Stat k="Patrimonio" v={money(account.equity)} />
                <Stat k="Retorno" v={pct(account.totalReturn, true)} />
                <Stat k="Acierto" v={pct(account.winRate)} />
                <Stat k="Factor de beneficio" v={factor(account.profitFactor)} />
                <Stat k="Expectativa" v={account.expectancyR === null ? "—" : `${account.expectancyR.toFixed(2)} R`} />
                <Stat k="Drawdown máx." v={pct(account.maxDrawdown)} />
                <Stat k="Cerradas" v={String(account.closed)} />
              </dl>
              <div className="grid gap-4 md:grid-cols-2">
                <LineChart
                  points={view.equityCurve}
                  getY={(point) => point.equity}
                  label="Patrimonio en papel"
                  summary={`Patrimonio actual ${money(account.equity)}`}
                  stroke={account.equity >= account.startingEquity ? "#22C55E" : "#EF4444"}
                  baseline={account.startingEquity}
                  baselineLabel="inicio"
                  formatY={(value) => money(value)}
                />
                <LineChart
                  points={view.drawdownCurve}
                  getY={(point) => -point.drawdown * 100}
                  label={`Drawdown · máximo ${pct(account.maxDrawdown)}`}
                  summary={`Drawdown máximo ${pct(account.maxDrawdown)}`}
                  stroke="#EF4444"
                  baseline={0}
                  baselineLabel="0%"
                  formatY={(value) => `${value.toFixed(1)}%`}
                />
              </div>
            </CardContent>
          </Card>

          {view.markets.map((market) => (
            <MarketCard
              key={market.id}
              market={market}
              busy={busy === `close-${market.id}`}
              onClose={() => void act(`close-${market.id}`, { type: "close", id: market.id })}
            />
          ))}

          <Card>
            <CardHeader>
              <CardTitle>Operaciones cerradas</CardTitle>
            </CardHeader>
            <CardContent className="max-h-96 overflow-auto">
              {view.trades.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aún no hay operaciones cerradas. Con velas de {view.settings.interval} las señales llegan en horas o días, no en segundos: es lo esperado en una estrategia de tendencia.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cierre</TableHead>
                      <TableHead>Mercado</TableHead>
                      <TableHead>Entrada → salida</TableHead>
                      <TableHead>R</TableHead>
                      <TableHead>PnL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.trades.map((trade) => (
                      <TableRow key={trade.id}>
                        <TableCell className="num text-xs">{when(trade.exitT)}</TableCell>
                        <TableCell>
                          {trade.market}
                          <span className="block text-xs text-muted-foreground">{trade.note}</span>
                        </TableCell>
                        <TableCell className="num text-xs">{price(trade.entryPrice)} → {price(trade.exitPrice)}</TableCell>
                        <TableCell className={`num ${tone(trade.r)}`}>{trade.r.toFixed(2)}</TableCell>
                        <TableCell className={`num ${tone(trade.pnl)}`}>{money(trade.pnl, true)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bitácora</CardTitle>
              <CardDescription>Lo que el bot decidió y por qué.</CardDescription>
            </CardHeader>
            <CardContent className="max-h-96 overflow-auto text-sm">
              <ul className="flex flex-col gap-2">
                {view.log.map((line) => (
                  <li key={line.id}>
                    <span className="num text-xs text-muted-foreground">{when(line.t)}{line.market ? ` · ${line.market}` : ""}</span>
                    <span className={`block ${line.tone === "buy" ? "gain" : line.tone === "warn" ? "text-amber-400" : line.tone === "sell" ? "text-orange-300" : ""}`}>
                      {line.text}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <details className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10 lg:col-span-2">
            <summary className="min-h-11 cursor-pointer text-sm font-medium">Ajustes de estrategia y riesgo</summary>
            {settings ? (
              <form
                className="mt-4 flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void act("settings", { type: "settings", settings });
                }}
              >
                <p className="text-sm text-muted-foreground">
                  Cambiar mercados, velas o estrategia cierra las posiciones al último precio y reparte el capital de nuevo. Cambiar solo el riesgo no toca las posiciones.
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <SelectField
                    label="Velas"
                    value={settings.interval}
                    options={[
                      { value: "1h", label: "1 hora" },
                      { value: "4h", label: "4 horas (recomendado)" },
                      { value: "1d", label: "1 día" },
                    ]}
                    onChange={(value) => edit("interval", value as BotSettings["interval"])}
                  />
                  <SelectField
                    label="Estrategia"
                    value={settings.strategy}
                    options={[
                      { value: "auto", label: "Automática (solo la que pasa validación)" },
                      ...view.strategies.map((strategy) => ({ value: strategy.id, label: strategy.name })),
                    ]}
                    onChange={(value) => edit("strategy", value as BotSettings["strategy"])}
                  />
                </div>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium">Mercados</legend>
                  <div className="flex flex-wrap gap-2">
                    {MARKETS.map((market) => {
                      const on = settings.markets.includes(market.id);
                      return (
                        <label
                          key={market.id}
                          className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${on ? "border-primary bg-primary/10" : "border-border"}`}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(event) =>
                              edit(
                                "markets",
                                event.target.checked
                                  ? [...settings.markets, market.id]
                                  : settings.markets.filter((id) => id !== market.id),
                              )
                            }
                          />
                          {market.symbol}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Riesgo por operación" suffix="%" value={settings.riskPerTrade * 100} onChange={(value) => edit("riskPerTrade", value / 100)} />
                  <Field label="Exposición máxima por mercado" suffix="%" value={settings.maxExposure * 100} onChange={(value) => edit("maxExposure", value / 100)} />
                  <Field label="Corte por drawdown de la cuenta" suffix="%" value={settings.maxDrawdownHalt * 100} onChange={(value) => edit("maxDrawdownHalt", value / 100)} />
                  <Field label="Corte por pérdida diaria" suffix="%" value={settings.dailyLossHalt * 100} onChange={(value) => edit("dailyLossHalt", value / 100)} />
                  <Field label="Comisión por lado" suffix="%" value={settings.feeBps / 100} onChange={(value) => edit("feeBps", value * 100)} />
                  <Field label="Deslizamiento por lado" suffix="%" value={settings.slippageBps / 100} onChange={(value) => edit("slippageBps", value * 100)} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" className="min-h-11 cursor-pointer" disabled={busy === "settings" || settings.markets.length === 0}>
                    Guardar ajustes
                  </Button>
                  {draft ? (
                    <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" onClick={() => setDraft(null)}>
                      Descartar cambios
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" className="min-h-11 cursor-pointer" disabled={busy === "revalidate"} onClick={() => void act("revalidate", { type: "revalidate" })}>
                    <RefreshCw aria-hidden="true" /> Revalidar estrategias
                  </Button>
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
                {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
              </form>
            ) : null}
          </details>
        </div>
      )}
    </main>
  );
}

function MarketCard({ market, busy, onClose }: { market: MarketView; busy: boolean; onClose: () => void }) {
  const position = market.position;
  const status = position
    ? { label: "En posición", variant: "default" as const }
    : market.strategy
      ? { label: market.pending?.kind === "buy" ? "Compra en la próxima vela" : "Esperando señal", variant: "outline" as const }
      : { label: market.validation ? "Sin estrategia validada" : "Validando…", variant: "secondary" as const };
  const ind = market.indicators;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>
            {market.symbol} <span className="num text-base font-normal text-muted-foreground">{price(market.lastPrice)} US$</span>
          </span>
          <Badge variant={status.variant}>{status.label}</Badge>
        </CardTitle>
        <CardDescription>
          {market.strategyName ? `${market.strategyName}. ${market.strategySummary}` : "En modo automático solo se opera una estrategia que pase la validación walk-forward en este mercado."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <CandleChart
          bars={market.chart}
          markers={market.markers}
          stop={position?.stop ?? null}
          entry={position?.entryPrice ?? null}
          summary={`${market.symbol}: últimas ${market.chart.length} velas`}
        />
        {ind ? (
          <>
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <Stat k="RSI 14" v={ind.rsi14 === null ? "—" : ind.rsi14.toFixed(0)} />
              <Stat k="ADX 14" v={ind.adx14 === null ? "—" : ind.adx14.toFixed(0)} />
              <Stat k="ATR / precio" v={pct(ind.atrPct)} />
            </dl>
            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {ind.read.map((line) => (
                <li key={line}>· {line}</li>
              ))}
            </ul>
          </>
        ) : null}
        {position ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background/50 px-3 py-2 text-sm">
            <div>
              <p className="num">
                Entrada {price(position.entryPrice)} · stop {price(position.stop)} · {position.barsHeld} velas
              </p>
              <p className="text-xs text-muted-foreground">{position.note}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`num ${tone(position.unrealized)}`}>{money(position.unrealized, true)}</span>
              <Button type="button" size="sm" variant="outline" className="cursor-pointer" disabled={busy} onClick={onClose}>
                Cerrar
              </Button>
            </div>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Capital del mercado {money(market.equity)} · realizado <span className={tone(market.realized)}>{money(market.realized, true)}</span> · {market.trades} operaciones ({market.wins} ganadoras)
        </p>
        {market.error ? <p className="text-xs text-destructive">{market.error}</p> : null}
        {market.validation ? (
          <details className="text-xs">
            <summary className="min-h-9 cursor-pointer font-medium">
              Validación walk-forward · {market.validation.bars} velas · {when(market.validation.at)}
            </summary>
            <div className="mt-2 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Estrategia</TableHead>
                    <TableHead>Ops</TableHead>
                    <TableHead>Factor</TableHead>
                    <TableHead>Retorno</TableHead>
                    <TableHead>Fuera de muestra</TableHead>
                    <TableHead>DD</TableHead>
                    <TableHead>Comprar y mantener</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {market.validation.checks.map((check) => (
                    <TableRow key={check.strategy} className={check.strategy === market.validation?.chosen ? "bg-primary/10" : ""}>
                      <TableCell>
                        {check.name}
                        <span className={`block ${check.pass ? "gain" : "text-muted-foreground"}`}>
                          {check.pass ? (check.strategy === market.validation?.chosen ? "Pasa · elegida" : "Pasa") : check.reasons.join(" · ")}
                        </span>
                      </TableCell>
                      <TableCell className="num">{check.full.trades}</TableCell>
                      <TableCell className="num">{factor(check.full.profitFactor)}</TableCell>
                      <TableCell className={`num ${tone(check.full.totalReturn)}`}>{pct(check.full.totalReturn, true)}</TableCell>
                      <TableCell className={`num ${tone(check.oosReturn)}`}>{pct(check.oosReturn, true)}</TableCell>
                      <TableCell className="num">{pct(check.full.maxDrawdown)}</TableCell>
                      <TableCell className={`num ${tone(check.full.buyHoldReturn)}`}>{pct(check.full.buyHoldReturn, true)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
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

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = label.replace(/\s+/g, "-").toLowerCase();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-lg border border-input bg-background px-3 text-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
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
          onChange={(event) => {
            const next = Number(event.target.value.replace(",", "."));
            if (Number.isFinite(next)) onChange(next);
          }}
        />
        <span className="w-10 text-xs text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}
