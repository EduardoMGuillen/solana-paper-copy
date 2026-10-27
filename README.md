# PolloTraderBot

Liquidity bot for **Meteora DLMM** on Solana, with a green terminal UI and a desktop app for Windows and Linux.

It puts SOL into Bid-Ask pools below the price, and closes each position at take profit, at the stop, or at the max hold time. It reads the position's value on chain, fees included, never from a model.

> **It moves real money.** On Start, the bot signs transactions with your dedicated wallet. Use it only for the bot and keep in it only what you are willing to lose. The hard limits (`LIVE_LP_MAX_SOL`, `LIVE_MIN_SOL_RESERVE`, the `KILL` file) live in the config and the UI cannot change them. The full design is in [docs/EJECUCION-REAL.md](docs/EJECUCION-REAL.md).

## Strategy

Every 15 s, if there is free SOL, the bot picks, among the token/SOL pools that pass the filter, the one that earns the most fees for its liquidity. It puts 25% of the free SOL below the price, Bid-Ask shaped down to −75%. It closes at +8%, at −20% or after 24 h, measured with the real on-chain value of the position. If the price drops 20% between two readings, it closes immediately.

Hourly backtest over the last month (Sep 26 – Oct 26, 2026, 105 SOL pools), in SOL, where holding SOL = 0%:

| Profile | Realistic fees | Pessimistic fees | Worst position |
|---|---|---|---|
| **Recommended** (default) | +5% to +7% | −2% to 0% | −21% |
| Conservative (pools 14+ days old, TVL 50k+) | −2% to −4% | −4% to −5% | −10% |
| Aggressive | +23% to +24% | +6% to +7% | −8% (only 36 positions) |
| The previous strategy (10%, reopen at +10%) | −7% to −17% | −10% to −20% | −21% |

This is **a single month**. The history only includes pools that are still alive and uses today's TVL, so pools that sank do not count. Reality is probably worse. The `history` panel records the real result of every closed position: that is the measure that counts.

## Desktop app

### Install

| System | File | Notes |
|---|---|---|
| Windows | `PolloTraderBot Setup x.y.z.exe` | Built by the `desktop` GitHub Actions workflow (Actions → desktop → Run workflow). |
| Windows (portable) | `PolloTraderBot-x.y.z-win.zip` | Unzip and open `PolloTraderBot.exe`. Can be built from Linux, but it gets the generic Electron icon. |
| Linux (Ubuntu/Debian) | `pollotraderbot_x.y.z_amd64.deb` | **Recommended on Linux.** `sudo apt install ./pollotraderbot_*.deb`. Sets up the Chromium sandbox. |
| Linux (other) | `PolloTraderBot-x.y.z.AppImage` | On Ubuntu 24.04 or newer, AppArmor blocks the AppImage sandbox: use the `.deb` or launch it with `--no-sandbox`. |

### First run

1. Open PolloTraderBot. Since there is no wallet yet, the `wallet.import` panel appears.
2. Paste the **private key** of the wallet you use for the bot (Phantom → Export private key, or the `solana-keygen` array). The public address is optional, but it lets you check you pasted the right one.
   - The key goes from the form to the app's main process, never over HTTP, and is stored in `~/.solana-paper-bot/wallet.json` (on Windows, `C:\Users\<you>\.solana-paper-bot`) with owner-only permissions.
   - The bot never overwrites an existing wallet, since it may hold funds or positions. To change it, use **⚙ settings → change wallet** in the desktop app (bot stopped, no open positions); the old key is kept as a dated backup in the same folder.
   - **⚙ settings** also sets the RPC: paste a Helius or QuickNode URL, the app tests it and restarts the bot.
3. Review the parameters (`config` → `[show]`) and press **START**.

### Window, tray and configuration

- **Closing the window does not stop the bot.** The app stays in the system tray, next to the clock, and keeps watching open positions. To shut it down completely use tray → **Quit (stops the bot)**.
- **Configuration:** tray → *Open config folder* opens the data folder. It holds `config.env`, with Telegram, your own RPC and the `LIVE_*` limits; the template is [.env.example](.env.example). After changing it, quit and reopen the app.
- **Helius rebates:** with a Helius RPC the app adds `rebate-address` to the URL, and by default MEV rebates go to the author's wallet (`J723mhkAUyjKrR469XfHeMC2wGfcCU6EACMQtW6dQDBd`). To collect them yourself, put your address in `HELIUS_REBATE_ADDRESS`; to turn it off, set `off`.
- **Server log:** `logs/server.log`, in that same folder.

### Build the installers

```bash
npm run desktop -- --linux    # AppImage + .deb
npm run desktop -- --win      # NSIS installer (on Windows, or on Linux with Wine)
npm run desktop -- --win zip -c.win.signAndEditExecutable=false   # portable Windows build from Linux without Wine
npm run desktop:dev           # unpacked folder only, for testing
```

Everything goes to `dist-desktop/release/`. The script [scripts/desktop.mjs](scripts/desktop.mjs):

1. builds Next in standalone mode;
2. adds the Meteora SDK, which is loaded at runtime and not traced by Next;
3. bundles `desktop/main.ts` and `desktop/preload.ts` with esbuild;
4. calls electron-builder.

The icons are generated from the logo with `npm run icons`.

## Development

Requires **Node 22** or newer.

```bash
npm install
npm run dev            # dashboard on http://127.0.0.1:47231
npm test               # vitest
npx tsc --noEmit -p .  # types
npm run lint
npm run build

npm run wallet                       # create a new dedicated wallet (prints only the address)
npm run wallet -- import [ADDRESS]   # import your key; typed hidden in the terminal
npm run meteora -- scan | collect | report   # Meteora pool research
```

In a browser, the `wallet.import` panel only shows the `npm run wallet -- import` command. The form to paste the key exists only in the desktop app.

### 24/7 server

To run it on a VM with HTTPS and a password, follow [deploy/GUIA-GOOGLE-CLOUD.md](deploy/GUIA-GOOGLE-CLOUD.md). The VM uses `next start`, not the desktop app.

## History

Before it was called PolloTraderBot, this repo was a paper technical-analysis bot, with a Meteora paper book and a Jupiter shadow mode. Those parts were removed in commit `67066c8`. Their backtests, results and rejected ideas remain in git history.
