import type { Metadata } from "next";
import { MeteoraPanel } from "@/components/meteora-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Meteora · prueba en papel",
  description: "Rendimiento en papel de posiciones Bid-Ask solo en SOL sobre pools DLMM de Meteora.",
};

export default function MeteoraPage() {
  return <MeteoraPanel />;
}
