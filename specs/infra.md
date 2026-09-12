# Infra

Self-host with Node 22+ and Postgres. `npm run build` then `npm start` serves the UI, API, and worker in one process. Sleep off so take-profit / stop-loss keep running.

## Live

Variables: `AUTH_USERNAME`, `AUTH_PASSWORD`, `SESSION_SECRET`, `KEY_ENCRYPTION_SECRET`, `DATABASE_URL`, `NODE_ENV=production`. Do **not** set `DEMO` here.

CEX API keys need spot or futures trade permission. Withdrawals off.

## Demo (public paper)

Separate process and database. `DEMO=1`, `PUBLIC_BASE=/app`, `VITE_BASE=/app/` (build-time).

- Public site: `https://tenfigures.club` — landing at `/`, panel at `/app`.
- `/` is the landing (waitlist 100, GoFundMe). Optional `GOFUNDME_URL`.
- Crisp chat (`CRISP_WEBSITE_ID` in `src/shared/crisp.ts`) on the landing and the demo panel. Not on a live terminal.
- Waitlist mail: `RESEND_API_KEY`. `RESEND_FROM` default `"Ten Figures" <info@tenfigures.club>` (quoted display name).
- Worker on. Paper fills only. No live keys.
