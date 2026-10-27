/**
 * Dedicated Solana wallet, kept outside the repo.
 *
 * The dashboard and the API read only `wallet.address`. They never open
 * `wallet.json`. Nothing in this module signs or sends a transaction:
 * only `lp-chain.ts` opens the key, and only for Meteora live.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeAllPositions, closeOnePosition, parseLivePosition, type LivePosition } from "./live-book";
import { clampLiveParams, DEFAULT_LIVE_PARAMS, type LiveParams } from "./live-params";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
export const DEFAULT_LP_MAX_SOL = 0.3;
export const DEFAULT_MIN_RESERVE_SOL = 0.03;

export type WalletLimits = {
  liveMode: string;
  lpMaxSol: number;
  minReserveSol: number;
};

export type PortfolioRow = {
  address: string;
  /** Marked liquidity plus the position-account rent, when the rent could be read. */
  valueSol: number;
  rentSol: number | null;
  /** Result of the liquidity versus the deposit. Rent is not a gain or a loss. */
  pnlSol: number | null;
  /** Share of the wallet plus every position. Null when the total is unknown. */
  share: number | null;
};

export type PortfolioView = {
  totalSol: number | null;
  poolsSol: number;
  rows: PortfolioRow[];
};

export type WalletStatus = {
  ready: boolean;
  address: string | null;
  balanceSol: number | null;
  /** SOL/USDT used for `balanceUsd`. Null when the price feed failed. */
  solUsd: number | null;
  balanceUsd: number | null;
  /** Free SOL, marked liquidity and position rent. */
  portfolio: PortfolioView;
  lamports: number | null;
  /** True only while this window is running and there is no KILL file. */
  signing: boolean;
  running: boolean;
  params: LiveParams;
  positions: LivePosition[];
  /** Closed positions, newest last. */
  history: ClosedPosition[];
  /** What the last Start or Stop did. */
  notice: string | null;
  reason: string;
  kill: boolean;
  journal: number;
  limits: WalletLimits;
  error: string | null;
};

export function encodeBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits = [0];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += ALPHABET[digits[i]];
  return out;
}

export function decodeBase58(text: string): Uint8Array {
  const value = text.trim();
  if (!value) throw new Error("dirección vacía");
  let zeros = 0;
  while (zeros < value.length && value[zeros] === "1") zeros += 1;
  const bytes = [0];
  for (let i = zeros; i < value.length; i += 1) {
    const digit = ALPHABET.indexOf(value[i]);
    if (digit < 0) throw new Error("dirección inválida");
    let carry = digit;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) out[out.length - 1 - i] = bytes[i];
  return out;
}

export function walletDir(env: Record<string, string | undefined> = process.env): string {
  const set = env.WALLET_DIR?.trim();
  if (set) return path.resolve(/*turbopackIgnore: true*/ set);
  return path.join(os.homedir(), ".solana-paper-bot");
}

/** A key inside the project could be committed or synced with the folder. */
export function assertOutsideRepo(dir: string, cwd = process.cwd()): void {
  const resolved = path.resolve(/*turbopackIgnore: true*/ dir);
  const root = path.resolve(/*turbopackIgnore: true*/ cwd);
  const nested = resolved === root || resolved.startsWith(root + path.sep);
  if (nested) throw new Error("La wallet no puede vivir dentro del proyecto.");
}

export function signingBlocked(kill: boolean, running = false): string {
  if (kill) return "Corte de emergencia activo. No se abren posiciones.";
  if (running) return "Encendido: firma aperturas y cierres de Meteora dentro de los límites.";
  return "Apagado: no firma. Start abre posiciones reales con esta wallet.";
}

function limitsFrom(env: Record<string, string | undefined>): WalletLimits {
  return {
    liveMode: env.LIVE_MODE?.trim() || "paper",
    lpMaxSol: readSol(env.LIVE_LP_MAX_SOL, DEFAULT_LP_MAX_SOL),
    minReserveSol: readSol(env.LIVE_MIN_SOL_RESERVE, DEFAULT_MIN_RESERVE_SOL),
  };
}

function readSol(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function addressFile(dir: string): string {
  return path.join(dir, "wallet.address");
}

function secretFile(dir: string): string {
  return path.join(dir, "wallet.json");
}

export function readWalletAddress(dir: string): string | null {
  const file = addressFile(dir);
  if (!fs.existsSync(file)) return null;
  const address = fs.readFileSync(file, "utf8").trim();
  const decoded = decodeBase58(address);
  if (decoded.length !== 32) throw new Error("La dirección de la wallet no es una clave pública.");
  return address;
}

/** Public key that belongs to an ed25519 seed, checked before the file is written. */
function publicFromSeed(seed: Buffer): Buffer {
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const spki = createPublicKey(createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" })).export({
    type: "spki",
    format: "der",
  });
  return Buffer.from(spki.subarray(spki.length - 32));
}

function keypairBytes(): { secret: Buffer; address: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" });
  const spki = publicKey.export({ type: "spki", format: "der" });
  if (pkcs8.length < 32 || spki.length < 32) throw new Error("No se pudo generar la clave.");
  const seed = pkcs8.subarray(pkcs8.length - 32);
  const pub = Buffer.from(spki.subarray(spki.length - 32));
  if (!publicFromSeed(Buffer.from(seed)).equals(pub)) throw new Error("La clave pública no corresponde a la semilla.");
  return { secret: Buffer.concat([seed, pub]), address: encodeBase58(pub) };
}

/**
 * Create the wallet once. If both files already exist, keep them.
 * Returns only the public address.
 */
export function createDedicatedWallet(dir: string, cwd = process.cwd()): string {
  assertOutsideRepo(dir, cwd);
  fs.mkdirSync(dir, { recursive: true });
  const secretPath = secretFile(dir);
  const publicPath = addressFile(dir);
  const journal = path.join(dir, "intents.jsonl");
  if (!fs.existsSync(journal)) fs.writeFileSync(journal, "", { encoding: "utf8" });
  if (fs.existsSync(publicPath) && fs.existsSync(secretPath)) return readWalletAddress(dir) ?? "";
  if (fs.existsSync(secretPath) || fs.existsSync(publicPath)) {
    throw new Error("La wallet está a medias. No se genera otra encima.");
  }
  const { secret, address } = keypairBytes();
  fs.writeFileSync(secretPath, JSON.stringify([...secret]), { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(publicPath, `${address}\n`, { encoding: "utf8" });
  return address;
}

const BAD_SECRET = "Eso no es una clave privada de Solana. Pega la de Phantom (base58) o el arreglo de solana-keygen.";

/** Phantom exports base58; solana-keygen writes a JSON array. Errors never repeat the input. */
function parseSecret(text: string): Buffer {
  const value = text.trim();
  let bytes: Uint8Array;
  try {
    if (value.startsWith("[")) {
      const raw = JSON.parse(value) as unknown;
      if (!Array.isArray(raw) || !raw.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) throw new Error();
      bytes = Uint8Array.from(raw as number[]);
    } else {
      bytes = decodeBase58(value);
    }
  } catch {
    throw new Error(BAD_SECRET);
  }
  if (bytes.length !== 64) throw new Error(BAD_SECRET);
  return Buffer.from(bytes);
}

/**
 * Import the owner's existing key as the dedicated wallet. Same file format and
 * permissions as `createDedicatedWallet`. Never replaces a different wallet:
 * it may still hold SOL or open positions. Returns only the public address.
 */
export function importDedicatedWallet(dir: string, secretText: string, expectedAddress?: string, cwd = process.cwd()): string {
  assertOutsideRepo(dir, cwd);
  const secret = parseSecret(secretText);
  const seed = secret.subarray(0, 32);
  const pub = secret.subarray(32);
  if (!publicFromSeed(Buffer.from(seed)).equals(pub)) throw new Error("La clave privada no es válida: su mitad pública no corresponde.");
  const address = encodeBase58(pub);
  if (expectedAddress?.trim() && expectedAddress.trim() !== address) throw new Error("La clave no corresponde a la dirección que indicaste.");

  fs.mkdirSync(dir, { recursive: true });
  const secretPath = secretFile(dir);
  const publicPath = addressFile(dir);
  if (fs.existsSync(secretPath) || fs.existsSync(publicPath)) {
    if (readWalletAddress(dir) === address && fs.existsSync(secretPath)) return address;
    throw new Error("Ya hay una wallet en esa carpeta. Muévela a mano antes de importar otra; puede tener fondos o posiciones.");
  }
  const journal = path.join(dir, "intents.jsonl");
  if (!fs.existsSync(journal)) fs.writeFileSync(journal, "", { encoding: "utf8" });
  fs.writeFileSync(secretPath, JSON.stringify([...secret]), { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(publicPath, `${address}\n`, { encoding: "utf8" });
  return address;
}

/** Wallet SOL plus each position's marked liquidity and its account rent. */
export function portfolioView(
  balanceSol: number | null,
  positions: Pick<LivePosition, "address" | "stakeSol" | "positionPct">[],
  rents: ReadonlyMap<string, number | null> = new Map(),
): PortfolioView {
  const rows: PortfolioRow[] = positions.map((position) => {
    const rentSol = rents.has(position.address) ? (rents.get(position.address) ?? null) : null;
    const mark = position.positionPct == null ? position.stakeSol : position.stakeSol * (1 + position.positionPct);
    return {
      address: position.address,
      valueSol: mark + (rentSol ?? 0),
      rentSol,
      pnlSol: position.positionPct == null ? null : position.stakeSol * position.positionPct,
      share: null,
    };
  });
  const poolsSol = rows.reduce((sum, row) => sum + row.valueSol, 0);
  const totalSol = balanceSol == null ? null : balanceSol + poolsSol;
  if (totalSol != null && totalSol > 0) {
    for (const row of rows) row.share = row.valueSol / totalSol;
  }
  return { totalSol, poolsSol, rows };
}

/** Dollar value of a SOL balance. Missing price or balance stays null. */
export function withSolUsd(status: WalletStatus, solUsd: number | null): WalletStatus {
  const price = solUsd != null && solUsd > 0 ? solUsd : null;
  return {
    ...status,
    solUsd: price,
    balanceUsd: status.balanceSol != null && price != null ? status.balanceSol * price : null,
  };
}

export function parseAccountLamports(body: unknown, count: number): number[] {
  const record = (body ?? {}) as { result?: { value?: unknown }; error?: { message?: string } };
  if (record.error) throw new Error(record.error.message || "El RPC rechazó las cuentas.");
  const value = record.result?.value;
  if (!Array.isArray(value) || value.length !== count) throw new Error("El RPC no devolvió las cuentas.");
  return value.map((row) => {
    if (row == null) return 0;
    const lamports = (row as { lamports?: unknown }).lamports;
    if (typeof lamports !== "number" || !Number.isInteger(lamports) || lamports < 0) throw new Error("El RPC no devolvió el alquiler.");
    return lamports;
  });
}

export function parseLamports(body: unknown): number {
  const record = (body ?? {}) as { result?: { value?: unknown }; error?: { message?: string } };
  if (record.error) throw new Error(record.error.message || "El RPC rechazó el saldo.");
  const value = record.result?.value;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error("El RPC no devolvió un saldo.");
  return value;
}

type RpcPost = (url: string, init: { method: string; headers: { "content-type": string }; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function fetchAccountLamports(addresses: string[], rpcUrl: string, post: RpcPost = fetch): Promise<number[]> {
  if (addresses.length === 0) return [];
  const response = await post(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [addresses, { encoding: "base64" }] }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("El RPC no respondió las cuentas.");
  return parseAccountLamports(await response.json(), addresses.length);
}

export async function fetchLamports(address: string, rpcUrl: string, post: RpcPost = fetch): Promise<number> {
  const response = await post(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("El RPC no respondió el saldo.");
  return parseLamports(await response.json());
}

function botFile(dir: string): string {
  return path.join(dir, "bot.json");
}

type StoredBot = {
  running?: unknown;
  params?: unknown;
  positions?: unknown;
  notice?: unknown;
  digestAt?: unknown;
  skipped?: unknown;
  leftovers?: unknown;
  history?: unknown;
};

/**
 * One closed position. `positionPct` is the last on-chain read before the close, fees
 * included: the same number the exits decide on. Rent comes back on close and is not in it.
 */
export type ClosedPosition = {
  pool: string;
  name: string;
  stakeSol: number;
  openedAt: number;
  closedAt: number;
  reason: string;
  positionPct: number | null;
  resultSol: number | null;
  signature: string | null;
};

/** Closed positions kept in bot.json, newest last. */
export const MAX_HISTORY = 200;

function parseHistory(raw: unknown): ClosedPosition[] {
  if (!Array.isArray(raw)) return [];
  const rows = raw.flatMap((row): ClosedPosition[] => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    const stakeSol = num(item.stakeSol);
    const openedAt = num(item.openedAt);
    const closedAt = num(item.closedAt);
    if (typeof item.pool !== "string" || typeof item.name !== "string" || !(stakeSol && stakeSol > 0) || !openedAt || !closedAt) return [];
    return [{
      pool: item.pool,
      name: item.name,
      stakeSol,
      openedAt,
      closedAt,
      reason: typeof item.reason === "string" ? item.reason : "",
      positionPct: num(item.positionPct),
      resultSol: num(item.resultSol),
      signature: typeof item.signature === "string" ? item.signature : null,
    }];
  });
  return rows.slice(-MAX_HISTORY);
}

/** Token left in the wallet by a close whose sale back to SOL did not go through. */
export type Leftover = { pool: string; name: string; tokenMint: string; solIsY: boolean; since: number; triedAt: number };

export type LiveFile = {
  running: boolean;
  params: LiveParams;
  positions: LivePosition[];
  notice: string | null;
  digestAt: number | null;
  /** Pool address → time until which it may not be opened again. */
  skipped: Record<string, number>;
  leftovers: Leftover[];
  history: ClosedPosition[];
};

function emptyBot(): LiveFile {
  return { running: false, params: { ...DEFAULT_LIVE_PARAMS }, positions: [], notice: null, digestAt: null, skipped: {}, leftovers: [], history: [] };
}

function parseSkipped(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [address, until] of Object.entries(raw as Record<string, unknown>)) {
    if (address.length >= 32 && typeof until === "number" && until > 0) out[address] = until;
  }
  return out;
}

function parseLeftovers(raw: unknown): Leftover[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (typeof item.pool !== "string" || item.pool.length < 32 || typeof item.tokenMint !== "string" || item.tokenMint.length < 32) return [];
    const since = typeof item.since === "number" && item.since > 0 ? item.since : 0;
    return [{
      pool: item.pool,
      name: typeof item.name === "string" && item.name ? item.name : item.pool.slice(0, 6),
      tokenMint: item.tokenMint,
      solIsY: item.solIsY !== false,
      since,
      triedAt: typeof item.triedAt === "number" && item.triedAt > 0 ? item.triedAt : since,
    }];
  });
}

let walletQueue: Promise<unknown> = Promise.resolve();

/** One writer at a time for the live book, shared by the API and the runner. */
export function withWallet<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = walletQueue.then(fn, fn);
  walletQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function readLiveFile(dir: string): LiveFile {
  const file = botFile(dir);
  if (!fs.existsSync(file)) return emptyBot();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StoredBot;
    const positions = Array.isArray(parsed.positions) ? parsed.positions.flatMap((row) => {
      const position = parseLivePosition(row);
      return position ? [position] : [];
    }) : [];
    return {
      running: parsed.running === true,
      params: clampLiveParams(parsed.params),
      positions,
      notice: typeof parsed.notice === "string" ? parsed.notice : null,
      digestAt: typeof parsed.digestAt === "number" && parsed.digestAt > 0 ? parsed.digestAt : null,
      skipped: parseSkipped(parsed.skipped),
      leftovers: parseLeftovers(parsed.leftovers),
      history: parseHistory(parsed.history),
    };
  } catch {
    return emptyBot();
  }
}

/** Write then rename, so a crash mid-write cannot leave a torn book that reads as empty. */
export function writeLiveFile(dir: string, bot: LiveFile): void {
  fs.mkdirSync(dir, { recursive: true });
  const target = botFile(dir);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ ...bot, history: bot.history.slice(-MAX_HISTORY) }), "utf8");
  fs.renameSync(temp, target);
}

export function killFile(dir: string): boolean {
  return fs.existsSync(path.join(dir, "KILL"));
}

/** True only when this window's bot has been started and there is no KILL file. */
export function readLiveRunning(dir: string): boolean {
  if (killFile(dir)) return false;
  return readLiveFile(dir).running;
}

export function readLiveParams(dir: string): LiveParams {
  return readLiveFile(dir).params;
}

export function setLiveBot(dir: string, running: boolean, cwd = process.cwd()): { running: boolean; error: string | null } {
  assertOutsideRepo(dir, cwd);
  const current = readLiveFile(dir);
  if (running && killFile(dir)) {
    writeLiveFile(dir, { ...current, running: false, notice: "Corte de emergencia activo. No se abren posiciones." });
    return { running: false, error: "Corte de emergencia activo. El bot sigue apagado." };
  }
  if (!running) {
    const positions = closeAllPositions(current.positions);
    const had = current.positions.length;
    writeLiveFile(dir, {
      ...current,
      running: false,
      positions,
      notice: had === 0 ? "Stop: no había posiciones abiertas. El bot ya no abre." : "Stop está cerrando todas las posiciones.",
    });
    return { running: false, error: null };
  }
  writeLiveFile(dir, { ...current, running: true, notice: "Start: va a abrir posiciones reales con esta wallet. La reserva no se toca." });
  return { running: true, error: null };
}

/** Close one live position and leave the others, and leave Start as it was. */
export function closeLivePosition(dir: string, address: string, cwd = process.cwd()): { error: string | null } {
  assertOutsideRepo(dir, cwd);
  const current = readLiveFile(dir);
  const result = closeOnePosition(current.positions, address);
  if (!result.found) return { error: "Esa posición no está abierta." };
  writeLiveFile(dir, { ...current, positions: result.positions, notice: "Cierre manual pedido. Si el pool sigue cumpliendo, se puede volver a abrir." });
  return { error: null };
}

/** Rejected while the live bot is running. A KILL file counts as stopped. */
export function saveLiveParams(dir: string, raw: unknown, cwd = process.cwd()): { params: LiveParams; error: string | null } {
  assertOutsideRepo(dir, cwd);
  const current = readLiveFile(dir);
  if (current.running && !killFile(dir)) {
    return { params: current.params, error: "Para el bot para cambiar los parámetros." };
  }
  const params = clampLiveParams(raw, current.params);
  writeLiveFile(dir, { ...current, running: false, params });
  return { params, error: null };
}

function journalCount(dir: string): number {
  const file = path.join(dir, "intents.jsonl");
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, "utf8").split("\n").filter((line) => line.trim().length > 0).length;
}

export async function walletStatus(
  env: Record<string, string | undefined> = process.env,
  post?: RpcPost,
  cwd = process.cwd(),
): Promise<WalletStatus> {
  const limits = limitsFrom(env);
  const dir = walletDir(env);
  try {
    assertOutsideRepo(dir, cwd);
  } catch (cause) {
    return {
      ready: false,
      address: null,
      balanceSol: null,
      solUsd: null,
      balanceUsd: null,
      lamports: null,
      signing: false,
      running: false,
      params: { ...DEFAULT_LIVE_PARAMS },
      positions: [],
      history: [],
      notice: null,
      reason: signingBlocked(false, false),
      kill: false,
      journal: 0,
      limits,
      portfolio: portfolioView(null, []),
      error: cause instanceof Error ? cause.message : "Wallet fuera de lugar.",
    };
  }
  let address: string | null = null;
  try {
    address = readWalletAddress(dir);
  } catch (cause) {
    return {
      ready: false,
      address: null,
      balanceSol: null,
      solUsd: null,
      balanceUsd: null,
      lamports: null,
      signing: false,
      running: false,
      params: { ...DEFAULT_LIVE_PARAMS },
      positions: [],
      history: [],
      notice: null,
      reason: signingBlocked(false, false),
      kill: fs.existsSync(path.join(dir, "KILL")),
      journal: journalCount(dir),
      limits,
      portfolio: portfolioView(null, []),
      error: cause instanceof Error ? cause.message : "No se pudo leer la dirección.",
    };
  }
  const kill = killFile(dir);
  const stored = readLiveFile(dir);
  const running = kill ? false : stored.running;
  const base = {
    ready: address !== null,
    address,
    signing: running,
    running,
    params: stored.params,
    positions: stored.positions,
    history: stored.history,
    notice: stored.notice,
    reason: signingBlocked(kill, running),
    kill,
    journal: journalCount(dir),
    limits,
    solUsd: null,
    balanceUsd: null,
  };
  if (!address) {
    return { ...base, balanceSol: null, lamports: null, portfolio: portfolioView(null, stored.positions), error: "Todavía no hay wallet dedicada." };
  }
  const rpc = env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC;
  try {
    const lamports = await fetchLamports(address, rpc, post);
    const balanceSol = lamports / 1_000_000_000;
    const rents = await positionRents(stored.positions, rpc, post);
    return { ...base, balanceSol, lamports, portfolio: portfolioView(balanceSol, stored.positions, rents), error: null };
  } catch (cause) {
    return {
      ...base,
      balanceSol: null,
      lamports: null,
      portfolio: portfolioView(null, stored.positions),
      error: cause instanceof Error ? cause.message : "No se pudo leer el saldo.",
    };
  }
}

async function positionRents(positions: LivePosition[], rpcUrl: string, post?: RpcPost): Promise<Map<string, number | null>> {
  const rents = new Map<string, number | null>();
  const keyed = positions.flatMap((position) => (position.position ? [[position.address, position.position] as const] : []));
  if (keyed.length === 0) return rents;
  try {
    const amounts = await fetchAccountLamports(keyed.map(([, id]) => id), rpcUrl, post);
    keyed.forEach(([address], index) => rents.set(address, amounts[index] / 1_000_000_000));
  } catch {
    keyed.forEach(([address]) => rents.set(address, null));
  }
  return rents;
}
