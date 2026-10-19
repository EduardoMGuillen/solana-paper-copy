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
  const ys = ready ? values : [0, 1];
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

export function Sparkline({
  points,
  label,
}: {
  points: { pnl: number }[];
  label: string;
}) {
  const values = points.map((point) => point.pnl);
  const ready = values.length >= 2;
  const width = 160;
  const height = 36;
  const min = ready ? Math.min(...values, 0) : 0;
  const max = ready ? Math.max(...values, 0) : 1;
  const span = max - min || 1;
  const line = ready
    ? values
        .map((value, index) => {
          const x = (index / (values.length - 1)) * width;
          const y = 4 + (1 - (value - min) / span) * (height - 8);
          return `${x},${y}`;
        })
        .join(" ")
    : "";
  const last = values[values.length - 1] ?? 0;
  const summary = ready
    ? `${label}: PnL en papel ${last >= 0 ? "positivo" : "negativo"} ${last.toFixed(3)} SOL.`
    : `${label}: todavía sin serie de PnL en papel.`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={summary}
      className="h-9 w-28 shrink-0"
    >
      <title>{summary}</title>
      {ready ? (
        <polyline
          points={line}
          fill="none"
          stroke={last >= 0 ? "#22C55E" : "#EF4444"}
          strokeWidth="2"
        />
      ) : (
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="currentColor" strokeOpacity="0.35" />
      )}
    </svg>
  );
}
