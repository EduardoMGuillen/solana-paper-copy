/**
 * PolloTraderBot desktop shell.
 *
 * Runs the Next.js standalone server in an Electron utility process, bound to
 * 127.0.0.1 on a free port, and shows it in a native window. Closing the window
 * hides it to the tray so Meteora live keeps watching open positions; "Salir"
 * in the tray stops everything.
 *
 * The private key never crosses HTTP: the import form talks to this process over
 * IPC, and only from the app's own origin.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray, utilityProcess, type UtilityProcess } from "electron";
import { importDedicatedWallet, walletDir } from "../src/lib/exec/wallet";
import { parseEnv } from "./env";

const APP_NAME = "PolloTraderBot";
const RESTART_MS = 3_000;

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: UtilityProcess | null = null;
let origin = "";
let quitting = false;

function resource(...parts: string[]): string {
  return app.isPackaged ? path.join(process.resourcesPath, ...parts) : path.join(__dirname, "..", "desktop", ...parts);
}

function serverDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "..", ".next", "standalone");
}

function configFile(): string {
  return path.join(app.getPath("userData"), "config.env");
}

/** The user's settings live next to the app data, created from the template on first run. */
function loadConfig(): Record<string, string> {
  const file = configFile();
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(resource("config.env.example"), file);
  }
  return parseEnv(fs.readFileSync(file, "utf8"));
}

function serverEnv(port: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...loadConfig(),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("sin puerto"))));
    });
  });
}

function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });
      request.on("error", () => {
        if (Date.now() > deadline) reject(new Error("El servidor no arrancó."));
        else setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

function logStream(): fs.WriteStream {
  const dir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return fs.createWriteStream(path.join(dir, "server.log"), { flags: "a" });
}

/** Start the server; if it dies while the app is open, start it again so live positions stay watched. */
function startServer(port: number, env: NodeJS.ProcessEnv): void {
  const dir = serverDir();
  const log = logStream();
  log.write(`\n--- ${new Date().toISOString()} start on ${port}\n`);
  server = utilityProcess.fork(path.join(dir, "server.js"), [], { cwd: dir, env, stdio: "pipe", serviceName: `${APP_NAME} server` });
  server.stdout?.pipe(log);
  server.stderr?.pipe(log);
  server.on("exit", (code) => {
    log.write(`--- exit ${code}\n`);
    server = null;
    if (!quitting) setTimeout(() => startServer(port, env), RESTART_MS);
  });
}

function sameOrigin(url: string | undefined): boolean {
  try {
    return Boolean(url) && new URL(url!).origin === origin;
  } catch {
    return false;
  }
}

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 420,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: "#000000",
    icon: resource("icon.png"),
    autoHideMenuBar: true,
    show: !process.env.POLLO_SMOKE_SHOT,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  // Links leave the app for the system browser; the window itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!sameOrigin(url)) event.preventDefault();
  });
  win.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    win?.hide();
  });
  void win.loadURL(origin);
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(resource("tray.png")));
  tray.setToolTip(`${APP_NAME}: el bot sigue corriendo`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Abrir ${APP_NAME}`, click: showWindow },
      { label: "Abrir configuración", click: () => void shell.openPath(app.getPath("userData")) },
      { type: "separator" },
      {
        label: "Salir (detiene el bot)",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", showWindow);
}

ipcMain.handle("wallet:import", (event, secret: unknown, address: unknown) => {
  if (!sameOrigin(event.senderFrame?.url)) return { ok: false, error: "Origen no permitido." };
  if (typeof secret !== "string") return { ok: false, error: "Falta la clave." };
  try {
    const dir = walletDir({ ...process.env, ...loadConfig() });
    const imported = importDedicatedWallet(dir, secret, typeof address === "string" ? address : undefined, serverDir());
    return { ok: true, address: imported };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo importar." };
  }
});

async function smokeShot(file: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 4_000));
  const image = await win!.webContents.capturePage();
  fs.writeFileSync(file, image.toPNG());
  quitting = true;
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setName(APP_NAME);
  app.on("second-instance", showWindow);
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => {
    server?.kill();
  });
  app.on("window-all-closed", () => {
    // Keep running in the tray; only "Salir" quits.
  });

  void app.whenReady().then(async () => {
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    startServer(port, serverEnv(port));
    await waitForServer(origin);
    createWindow();
    createTray();
    if (process.env.POLLO_SMOKE_SHOT) void smokeShot(process.env.POLLO_SMOKE_SHOT);
  });
}
