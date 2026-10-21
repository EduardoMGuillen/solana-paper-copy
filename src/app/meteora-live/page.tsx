import type { Metadata } from "next";
import { WalletLive } from "@/components/wallet-live";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Meteora live · wallet",
  description: "Wallet Solana dedicada. No firma y no usa los libros de papel.",
};

export default function MeteoraLivePage() {
  return <WalletLive />;
}
