type Point = { t: number };

type LineChartProps<T extends Point> = {
  points: T[];
  getY: (point: T) => number;
  label: string;
  summary: string;
  stroke: string;
  baseline?: number;
  baselineLabel?: string;
  formatY: (value: number) => string;
  height?: number;
};

export function LineChart<T extends Point>({
  points,
  getY,
  label,
  summary,
  stroke,
  baseline,
  baselineLabel,
  formatY,
  height = 148,
}: LineChartProps<T>) {
  const values = points.map((point) => getY(point));
  const ready = values.length >= 2 && values.every((value) => Number.isFinite(value));
  const width = 640;
  const pad = 16;
  // Copy: pushing the baseline into `values` would draw an extra point at zero.
  const ys = ready ? [...values] : [0, 1];
  if (baseline !== undefined && Number.isFinite(baseline)) ys.push(baseline);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const coords = ready
    ? values.map((value, index) => {
        const x = pad + (index / (values.length - 1)) * (width - pad * 2);
        const y = pad + (1 - (value - min) / span) * (height - pad * 2);
        return [x, y] as const;
      })
    : [];
  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const area =
    coords.length > 0
      ? `${pad},${height - pad} ${line} ${coords[coords.length - 1][0]},${height - pad}`
      : "";
  const baseY =
    baseline === undefined
      ? null
      : pad + (1 - (baseline - min) / span) * (height - pad * 2);

  return (
    <figure className="min-h-36">
      <figcaption className="mb-2 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="num text-muted-foreground">
          {ready ? `${formatY(values[0])} → ${formatY(values[values.length - 1])}` : "Sin serie"}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={summary}
        tabIndex={0}
        className="h-36 w-full rounded-lg bg-background/60 outline-none focus-visible:ring-3 focus-visible:ring-ring"
      >
        <title>{summary}</title>
        {ready ? (
          <>
            {baseY !== null ? (
              <g>
                <line
                  x1={pad}
                  x2={width - pad}
                  y1={baseY}
                  y2={baseY}
                  stroke="currentColor"
                  strokeOpacity="0.35"
                  strokeDasharray="4 4"
                />
                {baselineLabel ? (
                  <text x={pad} y={Math.max(12, baseY - 4)} fill="currentColor" opacity="0.7" fontSize="12">
                    {baselineLabel}
                  </text>
                ) : null}
              </g>
            ) : null}
            <polygon points={area} fill={stroke} opacity="0.18" />
            <polyline points={line} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" />
            <text x={pad} y={height - 4} fill="currentColor" opacity="0.65" fontSize="12">
              {formatY(min)}
            </text>
            <text x={width - pad} y={14} fill="currentColor" opacity="0.65" fontSize="12" textAnchor="end">
              {formatY(max)}
            </text>
          </>
        ) : (
          <text x={pad} y={height / 2} fill="currentColor" opacity="0.7" fontSize="14">
            La serie aparece con el primer movimiento.
          </text>
        )}
      </svg>
    </figure>
  );
}

type ChartBar = { t: number; o: number; h: number; l: number; c: number; ema20: number; ema50: number; ema200: number };
type Marker = { t: number; price: number; side: "buy" | "sell" };

const EMA_STYLE = [
  { key: "ema20", color: "#38BDF8", label: "EMA 20" },
  { key: "ema50", color: "#F59E0B", label: "EMA 50" },
  { key: "ema200", color: "#A78BFA", label: "EMA 200" },
] as const;

export function CandleChart({
  bars,
  markers,
  stop,
  entry,
  summary,
  height = 220,
}: {
  bars: ChartBar[];
  markers: Marker[];
  stop: number | null;
  entry: number | null;
  summary: string;
  height?: number;
}) {
  const width = 640;
  const padX = 8;
  const padY = 12;
  const axis = 52;
  if (bars.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg bg-background/60 text-sm text-muted-foreground">
        Descargando velas…
      </div>
    );
  }
  const levels = [
    ...bars.flatMap((bar) => [bar.h, bar.l]),
    ...bars.flatMap((bar) => [bar.ema20, bar.ema50, bar.ema200].filter(Number.isFinite)),
    ...(stop ? [stop] : []),
  ];
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  const span = max - min || 1;
  const plotW = width - padX - axis;
  const slot = plotW / bars.length;
  const x = (i: number) => padX + slot * i + slot / 2;
  const y = (v: number) => padY + (1 - (v - min) / span) * (height - padY * 2);
  const indexOf = (t: number) => {
    let best = -1;
    for (let i = 0; i < bars.length; i += 1) if (bars[i].t <= t) best = i;
    return best;
  };
  const line = (key: "ema20" | "ema50" | "ema200") =>
    bars
      .map((bar, i) => (Number.isFinite(bar[key]) ? `${x(i)},${y(bar[key])}` : null))
      .filter(Boolean)
      .join(" ");
  const fmt = (v: number) => v.toPrecision(5);

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={summary}
        className="h-56 w-full rounded-lg bg-background/60"
        preserveAspectRatio="none"
      >
        <title>{summary}</title>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padX} x2={width - axis} y1={y(min + span * f)} y2={y(min + span * f)} stroke="currentColor" strokeOpacity="0.08" />
            <text x={width - axis + 4} y={y(min + span * f) + 4} fill="currentColor" opacity="0.6" fontSize="11">
              {fmt(min + span * f)}
            </text>
          </g>
        ))}
        {bars.map((bar, i) => {
          const up = bar.c >= bar.o;
          const color = up ? "#22C55E" : "#EF4444";
          const top = y(Math.max(bar.o, bar.c));
          const bottom = y(Math.min(bar.o, bar.c));
          return (
            <g key={bar.t}>
              <line x1={x(i)} x2={x(i)} y1={y(bar.h)} y2={y(bar.l)} stroke={color} strokeWidth="1" />
              <rect x={x(i) - slot * 0.35} width={slot * 0.7} y={top} height={Math.max(1, bottom - top)} fill={color} opacity={up ? 0.85 : 0.75} />
            </g>
          );
        })}
        {EMA_STYLE.map((ema) => (
          <polyline key={ema.key} points={line(ema.key)} fill="none" stroke={ema.color} strokeWidth="1.6" strokeLinejoin="round" />
        ))}
        {entry ? (
          <line x1={padX} x2={width - axis} y1={y(entry)} y2={y(entry)} stroke="#38BDF8" strokeDasharray="2 3" strokeOpacity="0.8" />
        ) : null}
        {stop ? (
          <g>
            <line x1={padX} x2={width - axis} y1={y(stop)} y2={y(stop)} stroke="#EF4444" strokeDasharray="5 4" />
            <text x={padX + 2} y={y(stop) - 3} fill="#EF4444" fontSize="11">stop {fmt(stop)}</text>
          </g>
        ) : null}
        {markers.map((marker, k) => {
          const i = indexOf(marker.t);
          if (i < 0) return null;
          const buy = marker.side === "buy";
          const cx = x(i);
          const cy = y(marker.price) + (buy ? 10 : -10);
          const points = buy
            ? `${cx},${cy - 6} ${cx - 5},${cy + 3} ${cx + 5},${cy + 3}`
            : `${cx},${cy + 6} ${cx - 5},${cy - 3} ${cx + 5},${cy - 3}`;
          return <polygon key={`${marker.t}-${k}`} points={points} fill={buy ? "#22C55E" : "#F97316"} stroke="#0b0b0b" strokeWidth="0.8" />;
        })}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {EMA_STYLE.map((ema) => (
          <span key={ema.key} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3" style={{ background: ema.color }} />
            {ema.label}
          </span>
        ))}
        <span className="flex items-center gap-1"><span className="text-[#22C55E]">▲</span> compra</span>
        <span className="flex items-center gap-1"><span className="text-[#F97316]">▼</span> venta</span>
      </figcaption>
    </figure>
  );
}
