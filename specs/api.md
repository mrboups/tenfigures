# API

JSON, cookie session.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/login` | `{ username, password }` |
| POST | `/api/logout` | |
| GET | `/api/me` | |
| GET | `/api/venues` | Connector list |
| GET/POST/DELETE | `/api/exchanges` | POST tests keys before save |
| GET | `/api/exchanges/:id/balance` | |
| GET | `/api/exchanges/:id/markets` | `?quote=` |
| GET | `/api/exchanges/:id/ticker` | `?symbol=` |
| GET | `/api/exchanges/:id/bias` | `?symbol=` `&indicator=` |
| POST | `/api/bias` | `{ items, indicators? }` — 1D/4H/1H/15M/5M colors per indicator |
| GET/POST | `/api/trades` | Create SmartTrade (`entryType` limit/market/conditional/signal) |
| PATCH | `/api/trades/:id` | `{ note }` |
| POST | `/api/trades/:id/cancel` | Cancel open orders, mark cancelled |
| POST | `/api/trades/:id/close` | Market-close a position |
| POST | `/api/orders` | Simple buy/sell (no TP/SL) |
| GET | `/api/trades?scope=open|history` | Active vs closed/cancelled |
| GET | `/api/trades/:id/steps` | Buy/sell fill history |
| POST | `/api/trades/:id/add-funds` | Buy more into an open SmartTrade |
| POST | `/api/trades/:id/reduce-funds` | Sell part of an open SmartTrade |
| POST | `/api/trades/:id/cancel` | Stop managing on TenFigures; leave exchange orders in place |
| POST | `/api/trades/:id/close` | Market-close on the exchange |
| GET | `/api/dashboard` | Live portfolio + exchange cards |
| GET | `/api/exchanges/:id/details` | Balance, assets, open orders, snapshot series |
| GET | `/api/waitlist` | Demo. `{ count, cap, remaining }` — no auth |
| POST | `/api/waitlist` | Demo. `{ email }` — first 100. New emails get a Resend confirmation (access info in the next few days; questions via site chat). |
| GET | `/health` | No auth |

Demo (`DEMO=1`): login skipped; `/api/me` includes `demo: true` and `gofundmeUrl` when set; `POST /api/exchanges` is 403; trades and balances are scoped to the visitor paper wallet. After 45 seconds on the panel, a support overlay embeds the GoFundMe campaign widget.

Errors: `{ "error": "..." }` with 4xx.
