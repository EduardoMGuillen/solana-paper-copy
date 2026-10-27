/**
 * Build the PolloTraderBot desktop app.
 *
 *   npm run desktop              # installers for this OS
 *   npm run desktop -- --win     # Windows .exe (NSIS) from any OS
 *   npm run desktop -- --linux   # AppImage and .deb
 *   npm run desktop -- --dir     # unpacked app only, for a quick test
 *
 * Steps: standalone Next build → copy static files and the DLMM SDK the
 * runtime loader needs → bundle the Electron main and preload → electron-builder.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const appDir = path.join(root, "dist-desktop", "app");
const require = createRequire(import.meta.url);

function run(command, args, env = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function copy(from, to) {
  fs.cpSync(from, to, { recursive: true, force: true });
}

// 1. Self-contained server.
fs.rmSync(standalone, { recursive: true, force: true });
run(process.execPath, [require.resolve("next/dist/bin/next"), "build"], { NEXT_OUTPUT: "standalone", NEXT_TELEMETRY_DISABLED: "1" });
copy(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"));
copy(path.join(root, "public"), path.join(standalone, "public"));

// 2. lp-chain.ts loads the DLMM SDK through a runtime path that Next cannot trace. Trace it here.
const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft");
const loader = "src/lib/exec/load-dlmm.cjs";
const { fileList } = await nodeFileTrace([path.join(root, loader)], { base: root });
for (const file of fileList) {
  const target = path.join(standalone, file);
  if (fs.existsSync(target) || !fs.statSync(path.join(root, file)).isFile()) continue;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target);
}
console.log(`DLMM: ${fileList.size} archivos rastreados`);

// Next links hashed external names to node_modules. Windows installers do not keep symlinks, so make them real folders.
function dereference(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const real = fs.realpathSync(full);
      fs.rmSync(full);
      fs.cpSync(real, full, { recursive: true, dereference: true });
    } else if (entry.isDirectory()) {
      dereference(full);
    }
  }
}
dereference(path.join(standalone, ".next", "node_modules"));

// Secrets never ship: drop any env file the build may have copied.
for (const name of fs.readdirSync(standalone)) {
  if (name.startsWith(".env")) fs.rmSync(path.join(standalone, name));
}

// 3. Electron main and preload, bundled so the app folder needs no node_modules.
fs.rmSync(appDir, { recursive: true, force: true });
const common = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "warning" };
await build({ ...common, entryPoints: ["desktop/main.ts"], outfile: path.join(appDir, "main.cjs") });
await build({ ...common, entryPoints: ["desktop/preload.ts"], outfile: path.join(appDir, "preload.cjs") });
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
fs.writeFileSync(
  path.join(appDir, "package.json"),
  JSON.stringify(
    {
      name: "pollotraderbot",
      productName: "PolloTraderBot",
      version: pkg.version,
      description: "Bot de liquidez Meteora DLMM en Solana",
      author: { name: "PolloTraderBot", email: "noreply@pollotraderbot.app" },
      main: "main.cjs",
    },
    null,
    2,
  ),
);

// 4. Installers.
run(process.execPath, [require.resolve("electron-builder/cli.js"), "--config", "electron-builder.yml", ...process.argv.slice(2)]);
