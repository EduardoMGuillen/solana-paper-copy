"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ExperimentBalances } from "@/components/balances";
import { DeskNav } from "@/components/nav";
import { tradesBalanceSol, type SolSnapshot } from "@/lib/bot/balances";
import { LineChart } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MeteoraLiveView } from "@/lib/lp/forward";
import { METEORA_NEXT_SLOT, type OpenMeteora } from "@/lib/lp/livebook";
import type { MeteoraView, TradeRow } from "@/lib/lp/history";

const REASONS: Record<TradeRow["reason"], string> = {
  tiempo: "tiempo",
  "take-profit": "toma de ganancia",
  stop: "stop",
  "fuera de rango": "fuera de rango",
  manual: "cierre manual",
};

function pct(value: number, digits = 1, signed = false): string {
  const body = `${(value * 100).toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
  return signed && value > 0 ? `+${body}` : body;
}

function tone(value: number): string {
  if (value > 0) return "gain";
  if (value < 0) return "loss";
  return "text-muted-foreground";
}

function solAmount(value: number): string {
  return `${value.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} SOL`;
}

function positionNote(open: OpenMeteora): string {
  if (open.result > 0) return "En ganancia.";
  if (open.result < 0) return "En pérdida.";
  if (open.priceRatio > 1) return "Plana: el token subió y el SOL todavía no se usa. Ni gana ni pierde hasta que el precio baje de la entrada.";
  return "Plana: el token no ha bajado lo suficiente para mover el SOL.";
}

function when(ts: number): string {
  return new Date(ts).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function MeteoraPanel() {
  const [view, setView] = useState<MeteoraView | null>(null);
  const [live, setLive] = useState<MeteoraLiveView | null>(null);
  const [trades, setTrades] = useState<SolSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(refresh = false) {
    setLoading(true);
    try {
      const response = await fetch(refresh ? "/api/meteora?refresh=1" : "/api/meteora", { cache: "no-store" });
      const body = (await response.json()) as MeteoraView & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Meteora no respondió");
      setView(body);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo leer el test");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let stop = false;
    async function loadLive() {
      try {
        const response = await fetch("/api/meteora/live", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as MeteoraLiveView;
        if (!stop) setLive(body);
      } catch {
        // The historical study still renders if the live file is missing.
      }
    }
    void loadLive();
    const liveTimer = window.setInterval(() => {
      if (!document.hidden) void loadLive();
    }, 15_000);
    void fetch("/api/state", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { account?: SolSnapshot }) => {
        if (!stop && body.account) setTrades(body.account);
      })
      .catch(() => {
        // The Meteora report still renders if the trades account is unread.
      });
    void (async () => {
      try {
        const response = await fetch("/api/meteora", { cache: "no-store" });
        const body = (await response.json()) as MeteoraView & { error?: string };
        if (stop) return;
        if (!response.ok) throw new Error(body.error ?? "Meteora no respondió");
        setView(body);
        setError(null);
      } catch (cause) {
        if (!stop) setError(cause instanceof Error ? cause.message : "No se pudo leer el test");
      } finally {
        if (!stop) setLoading(false);
      }
    })();
    return () => {
      stop = true;
      window.clearInterval(liveTimer);
    };
  }, []);

  const primary = view?.scenarios.find((scenario) => scenario.id === "decoder") ?? null;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6">
      <header className="sticky top-0 z-20 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <DeskNav />
        <p className="mt-2 text-xs tracking-[0.18em] text-muted-foreground uppercase">Meteora DLMM · Bid-Ask · papel</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Rendimiento de los pools</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Posiciones simuladas, solo en SOL y por debajo del precio. Este sol no sale de la cuenta de trades. Si la media sale negativa, la estrategia pierde de verdad: las comisiones ya son una cota optimista. La wallet real, sin fondos y sin firmar, está en Meteora live y este libro no la usa.
            </p>
            <ExperimentBalances tradesSol={trades ? tradesBalanceSol(trades) : null} />
          </div>
          <Button type="button" variant="outline" className="min-h-11 cursor-pointer" disabled={loading} onClick={() => void load(true)}>
            <RefreshCw aria-hidden="true" />
            {loading ? "Leyendo pools…" : "Actualizar"}
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>En vivo · desde ahora</CardTitle>
          <CardDescription>
            Un sol propio. Cada posición nueva usa el {pct(METEORA_NEXT_SLOT, 0)} de ese sol. Las que ya estaban abiertas conservan su tamaño. Entra primero el pool que más comisiones cobra por su liquidez, solo en SOL y por debajo del precio. El precio de cada posición abierta se lee en cada ciclo del bot, unos 15 segundos. Sale al +8%, al −20% o a las 24 h. El estudio de abajo es el pasado; no entra en este saldo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="num text-lg">{live ? solAmount(live.equity) : "1,00 SOL"}</p>
          {live && live.opens.length > 0 ? (
            <div className="flex flex-col gap-3">
              {live.opens.map((open) => (
                <div key={open.address} className="grid gap-2 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted-foreground">{open.name}</p>
                    <p className="num text-lg">{solAmount(open.stake)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Token desde la entrada</p>
                    <p className={`num text-lg ${tone(open.priceRatio - 1)}`}>{pct(open.priceRatio - 1, 2, true)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Posición</p>
                    <p className={`num text-lg ${tone(open.result)}`}>{pct(open.result, 2, true)}</p>
                  </div>
                  <p className="text-muted-foreground sm:col-span-3">{positionNote(open)}</p>
                </div>
              ))}
              <p className="text-muted-foreground">Libre {solAmount(live.cash)}. Cada posición nueva usa el {pct(METEORA_NEXT_SLOT, 0)}.</p>
            </div>
          ) : (
            <p className="text-muted-foreground">Sin posición abierta. La primera foto llega en cuanto el servidor habla con Meteora; la primera salida puede tardar hasta 24 horas.</p>
          )}
          <p className="text-muted-foreground">
            {live?.snaps ? `${live.snaps} fotos` : "Todavía sin fotos"} · {live?.trades.length ?? 0} cerradas
            {live?.error ? ` · ${live.error}` : ""}.
          </p>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!view ? (
        <div className="min-h-[28rem] rounded-xl bg-card ring-1 ring-foreground/10" aria-busy="true" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                Estudio de los últimos {view.windowDays} días · {primary ? `${primary.trades} posiciones ya cerradas` : "sin posiciones"}
              </CardTitle>
              <CardDescription>
                {view.poolsWithHistory} pools con historia de {view.poolsSeen} que hoy pasan el filtro
                {view.from && view.to ? ` · cierres del ${when(view.from)} al ${when(view.to)}` : ""}.
                {view.failed > 0 ? ` ${view.failed} pools no respondieron y quedaron fuera.` : ""}
                {" "}Actualizado {new Date(view.generatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {primary && primary.trades > 0 ? (
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Stat k="Media" v={pct(primary.mean, 2, true)} className={tone(primary.mean)} />
                  <Stat k="Mediana" v={pct(primary.median, 2, true)} className={tone(primary.median)} />
                  <Stat k="Peor" v={pct(primary.worst, 1, true)} className={tone(primary.worst)} />
                  <Stat k="Acierto" v={pct(primary.winRate, 0)} />
                  <Stat k="Comisión media" v={pct(primary.meanFees, 2, true)} />
                  <Stat k="Caída > 60%" v={pct(primary.crashRate, 0)} />
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Todavía no hay una posición cerrada en esta ventana. Hace falta al menos dos cierres diarios después de un día que pase el filtro.
                </p>
              )}
              <LineChart
                points={view.curve}
                getY={(point) => point.sum * 100}
                label="Suma de resultados, en orden de cierre"
                summary={primary ? `Suma ${pct(primary.sum, 1, true)} en ${primary.trades} posiciones que pueden solaparse` : "Sin serie"}
                stroke={primary && primary.sum >= 0 ? "#22C55E" : "#EF4444"}
                baseline={0}
                baselineLabel="0%"
                formatY={(value) => `${value.toFixed(1)}%`}
              />
              <p className="text-xs text-muted-foreground">
                Cada posición vale 1 SOL de referencia. La suma no es el retorno de una cuenta: varios pools pueden estar abiertos el mismo día y no se reinvierte.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tres reglas de salida</CardTitle>
              <CardDescription>La misma entrada. Cambia el stop o el tiempo máximo, como en el reporte de la terminal.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Regla</TableHead>
                    <TableHead>Cerradas</TableHead>
                    <TableHead>Acierto</TableHead>
                    <TableHead>Media</TableHead>
                    <TableHead>Mediana</TableHead>
                    <TableHead>Peor</TableHead>
                    <TableHead>Suma</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.scenarios.map((scenario) => (
                    <TableRow key={scenario.id}>
                      <TableCell>{scenario.label}</TableCell>
                      <TableCell className="num">{scenario.trades}</TableCell>
                      <TableCell className="num">{pct(scenario.winRate, 0)}</TableCell>
                      <TableCell className={`num ${tone(scenario.mean)}`}>{pct(scenario.mean, 2, true)}</TableCell>
                      <TableCell className={`num ${tone(scenario.median)}`}>{pct(scenario.median, 2, true)}</TableCell>
                      <TableCell className={`num ${tone(scenario.worst)}`}>{pct(scenario.worst, 1, true)}</TableCell>
                      <TableCell className={`num ${tone(scenario.sum)}`}>{pct(scenario.sum, 1, true)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Por pool</CardTitle>
                <CardDescription>Regla Decoder. Ordenado de peor media a mejor.</CardDescription>
              </CardHeader>
              <CardContent className="max-h-96 overflow-auto">
                {view.pools.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ningún pool cerró una posición.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pool</TableHead>
                        <TableHead>N</TableHead>
                        <TableHead>Acierto</TableHead>
                        <TableHead>Media</TableHead>
                        <TableHead>Peor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {view.pools.map((pool) => (
                        <TableRow key={pool.address}>
                          <TableCell>
                            {pool.name}
                            <span className="block text-xs text-muted-foreground">{pool.address.slice(0, 4)}…{pool.address.slice(-4)}</span>
                          </TableCell>
                          <TableCell className="num">{pool.trades}</TableCell>
                          <TableCell className="num">{pct(pool.winRate, 0)}</TableCell>
                          <TableCell className={`num ${tone(pool.mean)}`}>{pct(pool.mean, 2, true)}</TableCell>
                          <TableCell className={`num ${tone(pool.worst)}`}>{pct(pool.worst, 1, true)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Cómo se calcula</CardTitle>
                <CardDescription>Lo que el número no dice por sí solo.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <ul className="flex list-disc flex-col gap-2 pl-4">
                  <li>Nada se firma. Es la misma prueba en papel del comando <span className="text-foreground">meteora</span>.</li>
                  <li>Solo entran pools con SOL que hoy tienen TVL de al menos 10.000 US$, comisiones 24 h de al menos 1.000 US$, comisión base de al menos 1% y volumen 1 h de al menos 10.000 US$. Los que ya murieron no aparecen.</li>
                  <li>El precio es el cierre diario, hasta 90 días. Un mínimo intradía que habría tocado el stop no se ve.</li>
                  <li>La comisión de cada día es la fee real de ese día partida por el TVL de ahora. La API no guarda el TVL histórico. Si el pool era más chico, el cobro real habría sido mayor, y al revés.</li>
                  <li>Mientras el cierre está dentro del rango, la posición cobra como si se llevara la tasa media del pool entero. Por eso la comisión es una cota alta, no el cobro de una posición chica.</li>
                  <li>La posición que seguiría abierta al último cierre no cuenta. Solo entran las cerradas.</li>
                </ul>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Posiciones cerradas</CardTitle>
              <CardDescription>Regla Decoder: toma de ganancia al +8%, stop al −20%, o 24 horas.</CardDescription>
            </CardHeader>
            <CardContent className="max-h-[32rem] overflow-auto">
              {view.trades.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay filas para mostrar.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Salida</TableHead>
                      <TableHead>Pool</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Precio</TableHead>
                      <TableHead>Marca</TableHead>
                      <TableHead>Comisión</TableHead>
                      <TableHead>Resultado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.trades.map((trade) => (
                      <TableRow key={`${trade.address}-${trade.entryT}`}>
                        <TableCell className="num text-xs">{when(trade.exitT)}</TableCell>
                        <TableCell>
                          {trade.name}
                          <span className="block text-xs text-muted-foreground">{when(trade.entryT)} → {when(trade.exitT)}</span>
                        </TableCell>
                        <TableCell>{REASONS[trade.reason]}</TableCell>
                        <TableCell className={`num ${tone(trade.exitRatio - 1)}`}>{pct(trade.exitRatio - 1, 1, true)}</TableCell>
                        <TableCell className={`num ${tone(trade.mark)}`}>{pct(trade.mark, 2, true)}</TableCell>
                        <TableCell className="num">{pct(trade.fees, 2, true)}</TableCell>
                        <TableCell className={`num ${tone(trade.result)}`}>{pct(trade.result, 2, true)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}

function Stat({ k, v, className = "" }: { k: string; v: string; className?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className={`num text-lg ${className}`}>{v}</dd>
    </div>
  );
}
