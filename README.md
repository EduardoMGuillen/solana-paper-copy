# Bot de estrategia Solana (papel)

Trading bot driven by technical analysis on real market data. It trades SOL and liquid Solana-ecosystem tokens (plus BTC/ETH) on **paper**, with the exact same bar-by-bar logic as its backtester, so the paper record is directly comparable to the backtest. It never signs or sends a transaction and never asks for a private key.

## Why it changed from the copy desk

The previous version was a copy-trading demo. Its profits were not real signals:

- The "Lumen" leader made money because the AURA price was hard-coded to rise 2.2% every tick (`demo.ts`). Fosa lost because DUNA/ECO were hard-coded to fall 4.5%.
- The "Meteora top 7" were **stakers ranked by stake size**, not profitable traders.
- Wallet copying polled a public RPC every ~25 s with a 20 s staleness filter, so on fast tokens most real signals would arrive too late to copy.

The bot now trades its own signals, and only on strategies that pass an out-of-sample test on the market they trade.

## Strategies

All long-only (spot, so it can go live through Jupiter later). Each decides on a **closed** candle and fills at the next candle's open. No look-ahead.

| Id | Method | Evidence |
|---|---|---|
| `cruce` | EMA 20/50 crossover above the EMA 200, 3-ATR trailing stop | Trend following / time-series momentum (Moskowitz, Ooi & Pedersen 2012; the most documented edge in crypto) |
| `regimen` | Hold while the close is above the SMA 200 and the EMA 50 confirms; 5-ATR catastrophe stop | Faber's trend filter (2007): keeps most of the bull market, avoids most crashes |
| `tendencia` | 20-bar Donchian breakout with ADX > 20, chandelier exit | Turtle breakout |
| `retroceso` | Connors RSI(2) pullback above the SMA 200 | Works in equities. **Loses in crypto** in our tests; kept as a control |

### Automatic mode (default)

Every 24 h, for each market, the bot downloads about 6,000 candles and runs a **walk-forward** for all four strategies: 70% in-sample, 30% out-of-sample. A strategy qualifies only if all of these hold:

- at least 20 trades
- profit factor ≥ 1.2
- positive out-of-sample return
- max drawdown ≤ 25%
- expectancy > 0.1 R

The bot then picks, among the strategies that qualify, the one with the best **in-sample** Sharpe. The out-of-sample block stays a check, not a selector. If no strategy qualifies, the bot does not trade that market. An open trade is never abandoned to switch strategies.

### Risk management

- **Risk-based sizing**: position = (sleeve equity × risk %) ÷ (entry − stop). If the initial stop is hit, you lose about the risk % of that market's capital (2% by default).
- No leverage (max exposure 100% per market). Capital is split evenly across markets.
- Fee and slippage are charged on every fill, in both the backtest and paper trading (10 + 10 bps per side).
- **Daily loss halt** (5%): no new entries until the next UTC day.
- **Drawdown halt** (20% from the account peak): no new entries until you resume by hand.
- Live stop: inside the current candle, the stop fires on the last price.

## Backtest results (real data, Oct 2026)

`npm run backtest -- 4h 9000 0.01 cruce,regimen` (4 h candles, ~4 years, 1% risk):

| Market | Strategy | Trades | PF | Return | OOS | Max DD | Buy & hold |
|---|---|---|---|---|---|---|---|
| SOL | cruce | 47 | 2.76 | +20.9% | +11.5% | 3.7% | +250% |
| SOL | regimen | 90 | 4.01 | +65.6% | +3.9% | 14.5% | +248% |
| BTC | cruce | 42 | 2.02 | +14.5% | +6.0% | 7.9% | +330% |
| ETH | cruce | 44 | 1.65 | +10.8% | +11.9% | 4.9% | +88% |
| JUP | cruce | 28 | 1.58 | +5.4% | +5.1% | 3.1% | −49% |
| WIF | cruce | 20 | 2.49 | +9.9% | +8.1% | 3.6% | −95% |

Returns scale roughly with the risk setting. At 3% risk, SOL `cruce` returned +68% with an 11% drawdown.

**Read these numbers honestly:**

- In a strong bull market, **buy & hold beats trend following**. The edge is risk-adjusted: much smaller drawdowns, and it sits out crashes (JUP −49%, WIF −95%).
- The returns are modest. Nothing here is a "passive income machine". Treat any strategy that promises more with suspicion.
- Past results do not guarantee future results. Four years is only a few market cycles.

## Profiles and the 1 SOL test

The paper account starts with **1 SOL** (change it under settings; applies on reset), valued at the SOL price at creation. The dashboard reports equity in USD and in SOL, and against **just holding the starting SOL**. If the bot cannot beat that, it is not worth running.

| Profile | Risk per trade | Halts | Portfolio backtest (Apr 2024 – Oct 2026) |
|---|---|---|---|
| Conservador | 2% | daily 5%, drawdown 20% | ~10%/yr, max drawdown ~5% |
| **Agresivo** (default) | 5% | daily 8%, drawdown 30% | ~20%/yr, max drawdown ~7% |

In the same window, buying and holding the same 5 tokens lost 45%. Expect live results around half the backtest return and up to twice its drawdown.

## What was tested and rejected

These ideas were backtested on real data with real costs and **did not survive**. They stay in the repo as research tools.

| Idea | Result |
|---|---|
| VWAP + EMA 9 (and EMA 9/20) scalping on 3m / 15m | Loses on every market even at 0.03% cost per side (best case on Solana). The stop is ~0.2% away, so fees eat a third to half of the risk on every trade. `npm run backtest -- 3m 34000 0.01 vwap9 3 3` |
| Momentum rotation across 21 Solana tokens (daily) | +75–83%/yr in 2022–2024 (meme boom), median **−67%** out of sample in 2025–2026 across 216 parameter sets. `npm run rotation` |
| Long/short trend following with 2–5x leverage (perps) | Shorts and perp funding make it worse than spot long-only; BTC at 5x lost 24% with a 72% drawdown out of sample |
| RSI(2) mean reversion | Profit factor < 1 on almost every market |

## Run

```bash
npm install
npm run dev        # http://127.0.0.1:47231
npm test           # unit tests, including live/backtest parity
npm run backtest   # every strategy × every market; args: interval bars risk strategies
```

The bot runs inside the server process (every 15 s) whether or not a browser is open. Positions persist in `data/bot-state.json` across restarts. Market data comes from Binance's public mirror (`data-api.binance.vision`, no key), with Coinbase as a fallback for SOL, BTC and ETH. Override the mirror with `BINANCE_DATA_URL`.

## Deploy 24/7 (Google Cloud or Oracle)

See [deploy/GUIA-GOOGLE-CLOUD.md](deploy/GUIA-GOOGLE-CLOUD.md). One command (`sudo bash deploy/install.sh`) installs the bot on a Debian/Ubuntu VM with HTTPS (Caddy + sslip.io), a random password, and a hardened systemd service.

The whole app (dashboard and API) is behind HTTP Basic auth when `BOT_PASSWORD` is set. Without it, the app answers on localhost only.

## Shadow mode (real Jupiter costs, no signing)

With `LIVE_MODE=shadow` and `JUPITER_API_KEY` set, every paper fill and an hourly probe per market are quoted on Jupiter Swap API v2 **without a taker**, so no transaction is ever returned to sign. The dashboard compares the real cost per side with the backtest's assumption. Running it at home: [docs/CORRER-EN-CASA.md](docs/CORRER-EN-CASA.md). Template: `.env.example`.

## Telegram alerts

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in the environment (on the VM: `/etc/solana-bot.env`). The bot then sends buys, sells, risk halts, strategy changes, data-feed outages and a daily summary, batched once per tick. Setup steps are in the deploy guide.

## Going live (designed, not implemented)

The full design is in [docs/EJECUCION-REAL.md](docs/EJECUCION-REAL.md): an executor interface (paper → shadow → live), Jupiter Swap API v2, Meteora DLMM positions, key handling, hard limits outside the dashboard, reconciliation and staged rollout. Summary:

Before risking money:

1. Run the bot on paper for **at least 4–8 weeks** and check that its trades and slippage match the backtest.
2. Execute through Jupiter (`/swap` API) with a **dedicated hot wallet** holding only the trading capital. Never use your main wallet.
3. Add order confirmation, retries, a priority-fee cap, and a check of the actual fill price against the expected price.
4. Start with an amount you can afford to lose entirely.
