import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BinaryRain } from "@/components/binary-rain";
import "@fontsource-variable/fira-code";
import "./globals.css";

export const metadata: Metadata = {
  title: "PolloTraderBot",
  description: "Meteora DLMM liquidity bot on Solana with a dedicated wallet.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="min-h-full bg-background text-foreground">
        <BinaryRain />
        <div className="relative z-10">{children}</div>
        <div className="scanlines" aria-hidden="true" />
      </body>
    </html>
  );
}
