import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fira_Code, Fira_Sans } from "next/font/google";
import "./globals.css";

const sans = Fira_Sans({
  variable: "--font-sans-app",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = Fira_Code({
  variable: "--font-mono-app",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Bot de estrategia Solana",
  description: "Bot de trading por análisis técnico con validación walk-forward. Papel, precios reales.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="es"
      className={`${sans.variable} ${mono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
