# Mesa de copia en papel

Paper-only Solana copy desk. Three simulated leaders trade on their own. The top 7 wallets come from Meteora Stake2Earn’s public vault ranking (no API key). The server never signs or sends a transaction and it never asks for a private key.

Meteora does not publish a keyless trader leaderboard. The desk labels the Stake2Earn list as a stake ranking, not as trading PnL.

## Run locally

```bash
npm install
npm run dev
```

Open http://127.0.0.1:47231

The dev server listens on `0.0.0.0:47231`.

The paper account starts at 100 US$. It opens and manages copies only while this process is running. There is no background trader.

On SIGINT or SIGTERM (Ctrl+C, or a normal stop) the process closes every open paper position at the latest price, including fee and slippage, appends those closes to the log, flushes the dataset, and only then exits.

Paper state is stored in `data/paper-state.json`. The effectiveness dataset — trades, session start/stop, equity curve, win rate, profit factor, max drawdown, and total return on the 100 US$ — is stored in `data/effectiveness.json`. Delete both files, or use **Reiniciar cuenta de papel**, to start over.

## Tests

```bash
npm test
```

## Optional wallet watch

Paste a mainnet address in the desk. New wallets stay in observation until you enable them. The app polls `https://api.mainnet-beta.solana.com` (override with `SOLANA_RPC_URL`). If that RPC fails, the error is shown and the demo leaders keep running.
