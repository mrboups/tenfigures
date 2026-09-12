# Architecture

```
browser  →  Hono (/api + static dist)
                 │
                 ├─ session cookie
                 ├─ Postgres (accounts, trades)
                 └─ worker loop
                        │
                        ├─ engine.tick (pure)
                        └─ CCXT (spot orders, tickers, balances)
```

`engine.ts` decides; `worker.ts` talks to exchanges. Tests cover `engine.ts` without the network. Ticket: pair title on the size card (`ADA / USDT`). Spot Smart Buy / Smart Cover under size; Trade/Convert toggle next to Cold start opens the simple ticket. Futures: Long/Short, leverage capped at 10x (`PANEL_MAX_LEVERAGE`). Liquidation on the positions bar sits left for longs, right for shorts.

CCXT class map: binance, mexc, gate, bitget, bybit, kraken / krakenfutures, hyperliquid, lighter. CEX defaultType follows spot vs swap. DEX perps use walletAddress + privateKey (Lighter also needs vendor/lighter WASM).

Venue `paper` (demo only): public Binance OHLCV/tickers, local fills in `paper_orders` / `paper_balances`. Each browser gets its own wallet via cookie `tradr_demo` (7 days). Seed BTC/ETH/XRP stay open per visitor; closing them does not empty someone else's demo. `DEMO=1` serves the SPA at `/app` when `PUBLIC_BASE=/app` and `VITE_BASE=/app/`. Landing at `/` uses real exchange marks from `screens/ex/` (DefiLlama / CoinGecko). Token marks live in `screens/tokens/` (CoinGecko / cryptologos) and replace the letter dots in the panel.
