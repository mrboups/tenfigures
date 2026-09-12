# Product

Single-user hosted terminal.

1. Sign in with the username/password set on the server.
2. Connect a CEX with API key + secret (passphrase on Bitget), or a perp DEX (Hyperliquid, Lighter) with wallet address + private key. Connection is tested with a live balance fetch before save.
3. Trade ticket (`screens/order.png`): exchange / market / pair, then chart + size (title is the pair, e.g. ADA / USDT) + take-profit + stop-loss. Spot: Smart Buy / Smart Cover under size; a Trade/Convert switch next to Cold start opens the simple buy/sell ticket (no TP/SL). Futures: Long/Short under size, leverage capped at 10x. One place-trade button.
4. SmartTrade: entry (limit, market, conditional, signal) + optional take-profit and stop-loss. Take-profit and stop-loss prices follow the selected Long or Short. Signal parks a cold start until every 1D/4H/1H/15M/5M of the chosen indicator is green (Long) or red (Short), then enters at market. Trailing, stop-loss timeout, move-to-breakeven run in the server loop.
5. Positions (`screens/positions.png`): pair, time, size, status bar (TP/SL price and $ P/L, nearest-miss marks; liquidation on the left for longs, on the right for shorts), P/L, note, refresh / close / cancel. Sound + row flash when a trade fills or closes. Add position on a waiting limit can rest another limit at a chosen price; it adds when that order fills.
6. Star strip: starred pairs show the ticker with the exchange name under it. Click a chip to open that pair on Trade (chart + ticket). Drag a chip to reorder. Indicator picker (sliders): None (ticker only), or one or more of TDPR, TDPR cross, Donchian Trend — each selected indicator is its own row of colored bullets (1D / 4H / 1H / 15M / 5M).

Also: dashboard (live balances, 24h change, snapshot chart), exchange detail (assets, open orders, settings), position menu (add/reduce funds, close at market, share, cancel-on-tradr), and history with buy/sell steps.

CEX spot and futures, plus Hyperliquid and Lighter perpetual DEX.

Public rollout (demo paper, waitlist, hosted beta, Ten Figures Club in-app at launch, pricing): `specs/roadmap.md`. Paper fills exist only when `DEMO=1` on a separate demo host.
