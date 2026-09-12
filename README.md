# Ten Figures

Trading panel for spot and perps. Connect Binance, MEXC, Gate.io, Bitget, Bybit, Kraken, Hyperliquid, or Lighter. Place an entry; the server keeps take-profit and stop-loss running after you close the browser.

Paper demo (no keys): [tenfigures.club](https://tenfigures.club)

## Run locally

Node 22+ and Postgres.

```bash
cp .env.example .env
# fill DATABASE_URL, AUTH_USERNAME, AUTH_PASSWORD, SESSION_SECRET, KEY_ENCRYPTION_SECRET
npm install
npm test
npm run dev
```

UI: http://localhost:5173  
API: http://localhost:3000

`KEY_ENCRYPTION_SECRET` must be 64 hex characters:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paper mode (no login, no connect-exchange): set `DEMO=1` in `.env`. Public prices, local fills.

## Self-host

One Node process serves the UI, API, and worker.

```bash
npm run build
npm start
```

| Variable | Purpose |
|---|---|
| `AUTH_USERNAME` / `AUTH_PASSWORD` | Login when `DEMO` is unset |
| `SESSION_SECRET` | Cookie signing |
| `KEY_ENCRYPTION_SECRET` | Encrypts exchange API keys at rest |
| `DATABASE_URL` | Postgres |

CEX keys need **spot or futures trade**. Leave **withdrawals off**.

Hyperliquid / Lighter: wallet address + private key (Hyperliquid: API wallet from the site, authorized on the main account). The server signs DEX orders.

Do not set `DEMO=1` on a process that holds real exchange keys.

## Scripts

- `npm run dev` — API + Vite + in-process worker
- `npm start` — production server (`dist/` + API + worker)
- `npm test` — engine, paper, session, mail, waitlist

## License

MIT. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
