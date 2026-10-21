/**
 * Append-only journal of live Meteora orders.
 * A line is written before a transaction is signed. The secret never goes in here.
 */

import fs from "node:fs";
import path from "node:path";

export type IntentStatus = "pending" | "sent" | "confirmed" | "failed";

export type Intent = {
  id: string;
  at: number;
  kind: "open" | "close" | "sell";
  pool: string;
  name: string;
  position: string | null;
  lamports: number;
  minBinId: number | null;
  maxBinId: number | null;
  solIsY: boolean | null;
  tokenMint: string | null;
  entryPrice: number | null;
  range: number | null;
  binStepBps: number | null;
  status: IntentStatus;
  signature?: string;
  error?: string;
};

function file(dir: string): string {
  return path.join(dir, "intents.jsonl");
}

export function appendIntent(dir: string, intent: Intent): void {
  fs.appendFileSync(file(dir), `${JSON.stringify(intent)}\n`, "utf8");
}

export function readIntents(dir: string): Intent[] {
  const target = file(dir);
  if (!fs.existsSync(target)) return [];
  const out: Intent[] = [];
  for (const line of fs.readFileSync(target, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Intent;
      if (parsed && typeof parsed.id === "string" && typeof parsed.pool === "string") out.push(parsed);
    } catch {
      // A torn last line is ignored. The next append starts on its own line.
    }
  }
  return out;
}
