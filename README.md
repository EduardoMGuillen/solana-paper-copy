# PolloTraderBot

Liquidity bot for **Meteora DLMM** on Solana, with a green terminal UI and a desktop app for Windows and Linux.

It puts SOL into Bid-Ask pools below the price, and closes each position at take profit, at the stop, or at the max hold time. It reads the position's value on chain, fees included, never from a model.

> **It moves real money.** On Start, the bot signs transactions with your dedicated wallet. Use it only for the bot and keep in it only what you are willing to lose. The hard limits (`LIVE_LP_MAX_SOL`, `LIVE_MIN_SOL_RESERVE`, the `KILL` file) live in the config and the UI cannot change them. The full design is in [docs/EJECUCION-REAL.md](docs/EJECUCION-REAL.md).

## Strategy

Every 15 s, if there is free SOL, the bot picks, among the token/SOL pools that pass the filter, the one that earns the most fees for its liquidity. It skips tokens it already holds in another pool, since two pools of one memecoin double the same risk. It puts 25% of the wallet's SOL below the price, Bid-Ask shaped down to −75%, never more than the room left under `LIVE_LP_MAX_SOL` and never touching `LIVE_MIN_SOL_RESERVE`. With the default profile it closes at +8%, at −20% or after 24 h, measured with the real on-chain value of the position. If the price drops 20% between two readings, it closes immediately.

Hourly backtest over the last month (Sep 26 – Oct 26, 2026, 105 SOL pools), in SOL, where holding SOL = 0%:

| Profile | Pools | Exits | Realistic fees | Pessimistic fees | Worst position |
|---|---|---|---|---|---|
| **Recommended** (default) | TVL 10k+, fees 1k+/24 h | +8% / −20% / 24 h | +5% to +7% | −2% to 0% | −21% |
| Conservative | TVL 50k+, fees 2k+/24 h, 14+ days old | +8% / −20% / 24 h | −2% to −4% | −4% to −5% | −10% |
| Aggressive | TVL 5k+, fees 500+/24 h | +12% / −30% / 48 h | +23% to +24% | +6% to +7% | −8% (only 36 positions) |
| The previous strategy (10%, reopen at +10%) | | | −7% to −17% | −10% to −20% | −21% |

This is **a single month**. The history only includes pools that are still alive and uses today's TVL, so pools that sank do not count. Reality is probably worse. The `history` panel records the real result of every closed position: that is the measure that counts.

### Costs per position

- **Position rent:** ~0.06 SOL, plus ~0.0006 SOL per bin past 70 on extended positions (`LIVE_MAX_POSITION_BINS`). It comes back on close.
- **New bin arrays:** 0.0714 SOL each, never returned. Opens that need one are refused unless `LIVE_MAX_BIN_ARRAY_RENT_SOL` allows it.
- **Network:** a priority fee per transaction (`LIVE_PRIORITY_MICROLAMPORTS`, ~0.00001 SOL by default), and price impact when the leftover token is sold back to SOL on close.

With `LIVE_LP_MAX_SOL=0.3` (the default) and 25% per position, about 1 SOL in the wallet is a comfortable start.

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

### Telegram and the kill switch

- With `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `config.env`, the bot reports every open and close, with the profit or loss of each position, and sends a status digest every 15 min.
- That chat can send `balance`, `status`, `close`, `close <name>` and `stop` (closes all and stops opening). It cannot start the bot. Messages from any other chat are ignored.
- **Emergency stop:** create an empty file named `KILL` in the wallet folder (`~/.solana-paper-bot`). While it exists, the bot signs nothing.

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

> **Out of date:** that guide and `deploy/install.sh` still describe the old paper bot, and the script installs the `main` branch by default. To deploy PolloTraderBot, run it as `sudo env BRANCH=pollotraderbot bash install.sh` and put the `LIVE_*` limits in `/etc/solana-bot.env`.

### Landing page

[landing/index.html](landing/index.html) is a static product page (early-access list and an NFT mint marked "coming soon"). It is not part of the app and is not built by `npm run build`; open the file or host the `landing/` folder as is.

## History

Before it was called PolloTraderBot, this repo was a paper technical-analysis bot, with a Meteora paper book and a Jupiter shadow mode. Those parts were removed in commit `67066c8`. Their backtests, results and rejected ideas remain in git history.
