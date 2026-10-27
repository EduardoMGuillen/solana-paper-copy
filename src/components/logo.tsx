import { LOGO_GRID } from "@/lib/logo-grid";

const FILL: Record<string, string> = { "#": "var(--primary)", c: "var(--destructive)", b: "var(--warn)" };

/** The pixel chicken, drawn from the same grid as the app icons. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" shapeRendering="crispEdges" className={className} role="img" aria-label="PolloTraderBot">
      {LOGO_GRID.flatMap((row, y) =>
        [...row].map((cell, x) => (FILL[cell] ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={FILL[cell]} /> : null)),
      )}
    </svg>
  );
}
