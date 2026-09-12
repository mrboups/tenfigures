# Ten Figures

Trading panel. Public brand is **Ten Figures**. Objective: place real spot orders on connected exchanges and keep take-profit / stop-loss running on the server.

## Stack

- React + Vite UI (`src/client`)
- Hono + `tsx` API and worker (`src/server`)
- Postgres
- CCXT (Binance, MEXC, Gate.io, Bitget, Bybit, Kraken, Hyperliquid, Lighter)
- One Node process: web + worker. Postgres beside it.

## Rules

- Secrets never in git. Exchange keys encrypted with `KEY_ENCRYPTION_SECRET`.
- Auth policy **A** — login required at first touch because this process can spend exchange balances.
- No dummy balances, fills, or “coming soon” **on a live terminal**. Paper fills are allowed only when `DEMO=1` (`specs/roadmap.md`).
- English UI.
- Docs in `specs/`, `dev/`, `sources/` update with the code.

## Auth

`AUTH_USERNAME` and `AUTH_PASSWORD` are environment variables. There is no signup. Session cookie `tradr_session`, httpOnly, 7 days.

Demo (`DEMO=1`): no login. Cookie `tradr_demo` is one paper wallet per visitor. SPA at `/app` when `PUBLIC_BASE=/app`.

## Layout

- `src/server/engine.ts` — pure SmartTrade state machine (tested)
- `src/server/worker.ts` — applies engine actions via CCXT
- `src/server/app.ts` — HTTP
- `src/client/pages/Trade.tsx` — order ticket (`screens/order.png`)
- `src/client/pages/Positions.tsx` — positions table (`screens/positions.png`)
- `screens/details/` is out of scope until asked

## Roadmap

Public GTM is in `specs/roadmap.md`. Phase 1 = paper demo + waitlist/donate + local OSS. At launch (Phase 2) the app has a social side: join Ten Figures Club for insights. Do not mix paper into a live account.

## Guardrails

- Worker never logs API keys, secrets, or raw order payloads
- Delete exchange blocked while trades are open
- Confirm modal before live orders
