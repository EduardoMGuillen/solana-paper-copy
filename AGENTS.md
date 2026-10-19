# AGENTS.md: guide for AI assistants (Grok, Claude, Copilot, …)

Read this before changing anything. It explains what the project is, how it is wired, and the rules that keep it honest and safe. The owner writes in Spanish. Answer in Spanish; code comments stay in English.

## What this is

A **paper-trading bot for Solana tokens**, built with Next.js 16 and TypeScript. It has two parts:

1. **Trend trading:** EMA crossovers and similar strategies on 4h candles from Binance. Each strategy is walk-forward validated per market, and only strategies that pass are traded.
2. **Meteora DLMM research:** a collector and a paper simulator for Decoder-Farmer-style SOL-only Bid-Ask liquidity positions.

**No real money moves today.** There is no private key anywhere in the project. "Shadow mode" asks Jupiter for real quotes without a wallet, so nothing can be signed. Real execution is designed in `docs/EJECUCION-REAL.md` but not implemented.

## Commands

```bash
npm install
npm run dev            # dashboard on http://127.0.0.1:47231 (localhost needs no password)
npm test               # vitest; all tests must pass
npx tsc --noEmit -p .  # typecheck
npm run lint           # eslint
npm run build          # production build (must compile)

npm run backtest -- 4h 9000 0.02 cruce,regimen   # interval, bars, risk per trade, strategies[, feeBps, slipBps]
npm run rotation                                  # momentum-rotation research (rejected, kept as a record)
npm run meteora -- scan | collect | report        # Meteora DLMM pools: screen / snapshot / forward paper test
```

Before you say a change is done, run **typecheck, lint, tests and build**. All four must be green.

## Architecture

```
Binance klines (keyless) ──► src/lib/bot/market.ts
                                   │
src/lib/service.ts  (server loop every 15 s, started by src/instrumentation.ts)
  ├─ validate each market once a day: walkForward() over ~6000 bars → pick a strategy (auto mode)
  ├─ poll each market every 30 s → engine.onCandles()
  │     └─ sleeve.stepBar() on each CLOSED bar  ← the same function the backtester uses
  ├─ markAccount(): equity, daily-loss / drawdown halts, daily summary
  ├─ shadow(): Jupiter quotes for queued paper fills + hourly probes (LIVE_MODE=shadow)
  └─ notify(): batched Telegram alerts
State: data/bot-state.json (atomic write; PAPER_DATA_DIR overrides the folder)
UI: src/app/page.tsx → src/components/desk.tsx, polls /api/state every 30 s; actions via POST /api/actions
Auth: src/proxy.ts (HTTP Basic auth when BOT_PASSWORD is set; otherwise localhost only)
```

### Key invariant: the live bot equals the backtest

`src/lib/bot/sleeve.ts` drives both the backtest (`backtest.ts`) and the live paper bot (`engine.onCandles`):

- the decision is taken on bar *i*'s close;
- the fill happens at bar *i+1*'s open;
- the stop is checked against the bar's low, and a gap through the stop fills at the open.

`engine.test.ts` asserts that feeding bars one by one gives exactly the backtest's trades. **Never break this.** If you change trading logic, change it in `sleeve.ts` / `strategies.ts` so both paths get it, and keep that test green.

## File map

| Path | Role |
|---|---|
| `src/lib/bot/indicators.ts` | EMA, SMA, RSI, ATR, ADX, Donchian, MACD, session VWAP. Arrays are aligned to the input, NaN during warmup, and **never read future bars**. |
| `src/lib/bot/strategies.ts` | `cruce` (EMA 20/50 above EMA 200, the one that validates), `regimen` (SMA 200), `tendencia` (Donchian), `retroceso` (RSI-2), `vwap`, `vwap9`. Long-only. |
| `src/lib/bot/sleeve.ts` | One market's capital: risk-based sizing, fills, stops, fees and slippage. |
| `src/lib/bot/backtest.ts` | `runBacktest`, metrics, `walkForward` (70/30), `judge` (pass/fail gate). |
| `src/lib/bot/engine.ts` | Account state, live bar processing, halts, settings changes, log, alert flags, paper-fill queue. |
| `src/lib/bot/settings.ts` | `BotSettings`, the Conservador/Agresivo profiles, clamping. |
| `src/lib/bot/market.ts` | Markets, intervals, Binance and Coinbase candle fetch. |
| `src/lib/bot/view.ts` | Everything the dashboard shows (the `BotView` type). |
| `src/lib/bot/rotation.ts`, `universe.ts` | Momentum-rotation simulator (research only, rejected). |
| `src/lib/exec/*` | Shadow mode: `tokens.ts` (mints), `jupiter.ts` (quote, no taker), `shadow.ts` (cost math), `runner.ts` (plan, run, apply). |
| `src/lib/lp/*` | Meteora: `bidask.ts` (position value math), `meteora.ts` (API parsing, screen, forward test). |
| `src/lib/notify/telegram.ts` | Alert batching and sending. |
| `src/lib/service.ts` | Orchestration, the state lock (`withState`), dashboard actions. |
| `src/lib/store.ts`, `paths.ts` | Persistence. |
| `src/proxy.ts` | Auth for every route. |
| `src/components/desk.tsx`, `charts.tsx` | Dashboard, candlestick chart. |
| `scripts/*.ts` | Research CLIs (backtest, rotation, meteora). |
| `deploy/install.sh`, `deploy/GUIA-GOOGLE-CLOUD.md` | One-command VM install: Caddy HTTPS, systemd, Meteora timer. |
| `docs/` | `GUIA-DE-USO.md` (owner's guide), `CORRER-EN-CASA.md`, `EJECUCION-REAL.md` (live design). |

## Environment variables

Use `.env.local` on a PC and `/etc/solana-bot.env` on the VM. The template is `.env.example`.

| Variable | Effect |
|---|---|
| `BOT_PASSWORD`, `BOT_USER` | Basic auth. Without a password, only localhost is served. |
| `LIVE_MODE=shadow` + `JUPITER_API_KEY` | Shadow quotes on Jupiter Swap API v2 (`/order`, no `taker`). |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | Push alerts. |
| `SOLANA_RPC_URL` | RPC used to read token decimals. Defaults to the public RPC. |
| `PAPER_DATA_DIR` | Data folder. Defaults to `./data`. |
| `BINANCE_DATA_URL`, `METEORA_API_URL`, `JUPITER_API_URL` | Endpoint overrides. |

## Rules (do not break)

1. **Honesty over hype.** Never claim profits the data does not show. Every new strategy must be backtested with real fees and slippage and walk-forward validated. If it fails, say so and record it in the README's "What was tested and rejected". These ideas already failed with real data, so do not reintroduce them as winners:
   - VWAP/EMA scalping on 3m/15m;
   - momentum rotation across Solana tokens;
   - leveraged long/short perps;
   - RSI(2) mean reversion.
2. **No look-ahead.** Indicators and decisions may use closed bars only. The forming bar may only fill pending orders at its open and trigger stops.
3. **Keep live and backtest identical.** See the invariant above.
4. **No real-money code without the design.** Real execution must follow `docs/EJECUCION-REAL.md`:
   - executor interface;
   - hard limits in env, not editable from the web UI;
   - an intent journal written before signing;
   - reconciliation with on-chain balances;
   - a `KILL` file;
   - the staged rollout paper → shadow → micro → live.
   Do not add signing to the shadow path, and never send a `taker` in shadow quotes.
5. **Secrets.** Never commit keys, tokens, API keys or wallet files. `.env*` is gitignored except `.env.example`. Never log the Telegram token or put it in error messages.
6. **The dashboard may only reduce risk** once real money exists: pause, close. Risk limits live server-side.
7. **Fail closed.** On network or data errors, record the error on the market (`book.error`), keep running, and never open positions on bad data.
8. **Tests with every change.** Add or extend tests next to the module (`*.test.ts`).

## Known facts and gotchas

- **Validation:** auto mode currently picks `cruce` on SOL, BTC, ETH, JUP and WIF on 4h candles. The portfolio backtest (Apr 2024 – Oct 2026) gave ~10%/yr at 2% risk and ~20%/yr at 5% risk, with a max drawdown of 5–7%. Buy & hold lost 45% over the same window.
- **Shadow mode:**
  - The token mints in `exec/tokens.ts` are not yet verified live, especially BTC (cbBTC) and ETH (Wormhole WETH).
  - A quote more than 20% off Binance is flagged `suspicious`, which points to a wrong mint.
  - Jupiter v2 field names (`inAmount`, `outAmount`, `priceImpactPct`) were taken from public docs and are parsed defensively.
- **Meteora:** parsing follows the documented `GET /pair/all`. The collector runs as a separate, memory-capped systemd timer so it can never take the bot down.
- **Network blocks:** the owner's work network blocks Jupiter and Meteora. Test those features from home or the VM.
- **Platform:** `npm run dev` must work on Windows, so do not use `VAR=value cmd` syntax in package.json scripts.
- **Next.js 16:** middleware is now `src/proxy.ts`. Read `node_modules/next/dist/docs/` for the current APIs instead of relying on older Next.js knowledge.
