# AGENTS.md: guide for AI assistants (Grok, Claude, Copilot, …)

Read this before changing anything. It explains what the project is, how it is wired, and the rules that keep it honest and safe. The owner writes in Spanish. Answer in Spanish; code comments stay in English.

## What this is

**PolloTraderBot**: a Meteora DLMM liquidity bot for Solana, built with Next.js 16 and TypeScript, shipped as a web dashboard and as an Electron desktop app (Windows and Linux).

**It signs real transactions.** It uses a dedicated wallet kept outside the repo (`~/.solana-paper-bot` or `WALLET_DIR`). It signs only while the bot is started from the dashboard and there is no `KILL` file. `src/lib/exec/lp-chain.ts` is the only module that opens `wallet.json` to sign. Everything follows `docs/EJECUCION-REAL.md`:
- Hard limits come from env (`LIVE_*`).
- The journal (`intents.jsonl`) gets the signature after signing and before broadcast.
- Each pass reconciles signed opens against the accounts on chain.
- Exits use the position's on-chain value, fees included, never a model.

The paper strategy desk, the Meteora paper book and shadow mode were removed in `67066c8`. Their code, backtests and rejected ideas are in git history.

## Commands

```bash
npm install            # Node 22+
npm run dev            # dashboard on http://127.0.0.1:47231 (localhost needs no password)
npm test               # vitest; all tests must pass
npx tsc --noEmit -p .  # typecheck
npm run lint           # eslint
npm run build          # production build (must compile)

npm run wallet                        # create a dedicated wallet once
npm run wallet -- import [ADDRESS]    # import the owner's key from a hidden prompt
npm run meteora -- scan | collect | report   # Meteora DLMM pools: screen / snapshot / forward paper test (research)

npm run desktop -- --linux | --win    # installers in dist-desktop/release
npm run desktop:dev                   # unpacked app only
npm run icons                         # regenerate desktop/icon.png and tray.png from the logo grid
```

Before you say a change is done, run **typecheck, lint, tests and build**. All four must be green. If you touch `desktop/` or `scripts/desktop.mjs`, also run `npm run desktop:dev` and open the unpacked app.

## Architecture

```
src/instrumentation.ts ─► src/lib/live-loop.ts (every 15 s)
                            ├─ kickLiveLp()           exec/lp-runner.ts: reconcile, mark, close, retry leftovers, open
                            └─ kickTelegramCommands() exec/telegram-control.ts: saldo, estado, cerrar, stop
UI: src/app/page.tsx → src/components/wallet-live.tsx, polls /api/wallet every 15 s; Start/Stop/params/close via POST /api/wallet
Auth: src/proxy.ts (HTTP Basic auth when BOT_PASSWORD is set; otherwise localhost only)

Desktop (desktop/main.ts, Electron):
  utilityProcess runs the Next standalone server on 127.0.0.1:<free port>
  BrowserWindow shows it; closing hides to the tray, "Salir" stops the server
  config: <userData>/config.env (from .env.example), log: <userData>/logs/server.log
  wallet import: page → preload (window.pollo) → IPC "wallet:import" → importDedicatedWallet(); never over HTTP
```

## File map

| Path | Role |
|---|---|
| `src/lib/live-loop.ts` | The 15 s loop. Each kick guards its own reentry. |
| `src/lib/exec/lp-plan.ts` | Meteora live decisions, pure: pool choice, size, exits on the on-chain mark. |
| `src/lib/exec/lp-chain.ts` | Meteora live signing: open, close, sell, read position value. The only file that opens the key to sign. Loads the DLMM SDK through `load-dlmm.cjs` at a runtime path. |
| `src/lib/exec/lp-runner.ts` | Meteora live pass. |
| `src/lib/exec/wallet.ts` | Wallet files (create, import), live book (`bot.json`), status for the dashboard. |
| `src/lib/exec/intents.ts`, `live-book.ts`, `live-params.ts`, `sell-rule.ts` | Intent journal, positions, parameters and presets (Recomendado is the default), leftover-token sales. |
| `src/lib/lp/*` | Meteora: `bidask.ts` (position math), `meteora.ts` (API parsing, screen, forward test), `datapi.ts`, `history.ts`. |
| `src/lib/bot/market.ts` | SOL/USD price for the dashboard and Telegram. |
| `src/lib/notify/telegram.ts` | Live alerts and owner commands. |
| `src/components/wallet-live.tsx` | The dashboard (terminal theme), including the closed-position history. `wallet-import.tsx`, `logo.tsx`, `binary-rain.tsx`. |
| `src/lib/logo-grid.ts` | The pixel-chicken grid. `src/app/icon.svg`, `public/logo.svg` and `desktop/*.png` are drawn from it. |
| `desktop/main.ts`, `desktop/preload.ts` | Electron shell and its only bridge. |
| `scripts/desktop.mjs`, `electron-builder.yml` | Desktop build. |
| `.github/workflows/desktop.yml` | Builds the Windows NSIS installer on Windows and the Linux packages on Ubuntu. |
| `deploy/install.sh`, `deploy/GUIA-GOOGLE-CLOUD.md` | One-command VM install: Caddy HTTPS, systemd, Meteora collector timer. |
| `docs/` | `EJECUCION-REAL.md` (live design), `CLAUDE-CHANGES.md` (log of Claude commits; add an entry with each one). |

## Environment variables

Use `.env.local` for `npm run dev`, `/etc/solana-bot.env` on the VM, and `config.env` in the app data folder for the desktop app. The template is `.env.example`.

| Variable | Effect |
|---|---|
| `BOT_PASSWORD`, `BOT_USER` | Basic auth. Without a password, only localhost is served. |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Push alerts and owner commands. |
| `SOLANA_RPC_URL` | RPC for live reads and sends. Defaults to the public RPC. |
| `WALLET_DIR` | Wallet folder. Defaults to `~/.solana-paper-bot`. Must be outside the repo. |
| `LIVE_LP_MAX_SOL`, `LIVE_MIN_SOL_RESERVE` | Cap on open stake, and SOL that is never spent. |
| `LIVE_MAX_PRICE_IMPACT_BPS`, `LIVE_MAX_SLIPPAGE_BPS` | Impact and slippage limits for opens and leftover sales. |
| `LIVE_PRIORITY_MICROLAMPORTS` | Priority fee per compute unit. Defaults to 20000. |
| `LIVE_MAX_BIN_ARRAY_RENT_SOL` | Non-refundable bin-array rent an open may pay. Defaults to 0 (refuse). |
| `LIVE_MAX_POSITION_BINS` | Bins per position. 69 = standard positions only; 200 lets 0.8–1.25% pools take the full range. |
| `METEORA_API_URL`, `BINANCE_DATA_URL` | Endpoint overrides (Meteora pools, SOL price). |

## Rules (do not break)

1. **Honesty over hype.** Never claim profits the data does not show. Meteora paper results do not predict live ones (see below).
2. **No real-money code without the design.** Live execution follows `docs/EJECUCION-REAL.md`: hard limits in env, not editable from the UI; an intent journal written before broadcast; reconciliation with on-chain balances; a `KILL` file.
3. **Secrets.** Never commit keys, tokens, API keys or wallet files. `.env*` is gitignored except `.env.example`. Never log the Telegram token or a private key, and never put either in an error message.
4. **The private key never travels over HTTP.** It is imported from the CLI hidden prompt or through the desktop IPC bridge. Do not add an API route that accepts a key. Never overwrite an existing wallet.
5. **The dashboard may only reduce risk**, except Start: pause, close, stop. Risk limits live server-side.
6. **Fail closed.** On network or data errors, record the error, keep running, and never open positions on bad data.
7. **Tests with every change.** Add or extend tests next to the module (`*.test.ts`).

## Known facts and gotchas

- **Meteora paper vs live:** the `npm run meteora -- report` forward test charges the pool's fees/TVL on 1 SOL while price is inside the range. Bid-Ask puts most SOL in the lowest bins, so that likely overstates fees. It also ignores rent, exit impact and failed sends. Live uses the real on-chain value.
- **Meteora live costs:**
  - A position locks ~0.057 SOL of rent, returned on close.
  - Each new bin array costs ~0.0714 SOL that never comes back. Opens that need one are refused unless `LIVE_MAX_BIN_ARRAY_RENT_SOL` allows it.
- **No re-center on the way up.** Closing when the token rose 10% and reopening higher was removed: in the Sep–Oct 2026 hourly backtest it was 3 of every 4 exits, earned almost no fees and paid fees every round trip. Do not bring it back without a backtest that shows otherwise.
- **Default size is 25% per position.** A position over ~70 bins locks ~0.1 SOL of returnable rent, so at 10% positions shrank to ~0.025 SOL and fixed costs ate the fees.
- **DLMM loading:** `lp-chain.ts` requires `src/lib/exec/load-dlmm.cjs` from `process.cwd()` so Next does not bundle the SDK's broken ESM build. Next cannot trace it, so `scripts/desktop.mjs` traces it with nft and copies it into the standalone server. Keep both in step.
- **Desktop on Linux:** Ubuntu 24.04+ blocks Chromium's sandbox for AppImages through AppArmor. The `.deb` ships an AppArmor profile; for local tests run the unpacked app with `--no-sandbox`.
- **Windows build from Linux** needs Wine for NSIS and the exe icon. Without it, build `--win zip -c.win.signAndEditExecutable=false`, or use the GitHub workflow.
- **Network blocks:** the owner's work network blocks Jupiter and Meteora. Test those features from home or the VM.
- **Platform:** `npm run dev` must work on Windows, so do not use `VAR=value cmd` syntax in package.json scripts.
- **Next.js 16:** middleware is now `src/proxy.ts`. Read `node_modules/next/dist/docs/` for the current APIs instead of relying on older Next.js knowledge.
