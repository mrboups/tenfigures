# Roadmap

Public product later. The owner’s live terminal stays **private** (real keys, real orders). Do not mix paper into it.

Paper / dummy fills are allowed **only** on the separate demo (Phase 1) and as an explicit Paper venue. Live trading stays real.

## Pricing (as stated)

- Normal: **$15 / month**
- Floor / early: **$5 / month** (also described as 50% of $15 — **$5 vs $7.50 still to freeze** before the landing)
- First 100 waitlist: later beta + **1 free month** + floor price
- After that free month: pay the floor; then 50% of normal while they stay early
- Donors: **SmartTrade free for as long as the project exists** (`lifetime` flag)
- Phase 3: donors lifetime free, early adopters 50% always, everyone else normal

## Phase 1 — announce + demo + list

Go-to-market, not multi-user live trading.

1. **Announce** a local open-source app. Worker runs **on the user’s machine**; the computer stays on. Call for developers.
2. **Demo** on a **separate Railway project**. Paper trading only. No account creation. No connect-exchange. Real public prices, fake money, labeled Paper.
3. **Pre-signup** for the first **100**: later service + one free month + floor price. **Or donate** now to support the project and get SmartTrade free while the project exists.
4. Message: v1 is **advanced SmartTrade** (what the demo shows). Bots and the most-requested features ship **if the project has funds**. At launch the app also has a social side: **Ten Figures Club** for insights (see below — not a Phase 1 build).

### Phase 1 surfaces (do not merge)

| Surface | Role |
|---|---|
| Owner live terminal | Real keys, real orders. Untouched. Not this public repo’s host. |
| Demo host | Public paper demo. `DEMO=1`. Own Postgres. Worker **on**. |
| GitHub `tenfigures` | Local OSS. Call for developers. |
| Landing | Demo link, waitlist 100, donate. `tenfigures.club`. |

### Demo rules

- One **paper wallet per visitor** (anonymous cookie, ~7 days). Not one shared paper account.
- Venue `paper` only. Public ticker/OHLCV (no keys). Market fills at last; limit / TP / SL fill when the public price crosses. Worker must run or TP/SL look dead.
- Connect exchange hidden in UI and rejected by the API.
- Confirm and positions say **Paper**.

### Local OSS (announced in Phase 1)

- `npm run dev`: UI + API + **in-process worker**. No hosted worker for that user.
- Secrets never in git. `.env.example` only.
- CONTRIBUTING: issues; user-requested work is prioritized when funded.

### Waitlist + donate (Phase 1)

- Email + timestamp, hard cap 100, export. No password.
- Donate via a simple rail (Stripe Payment Link, GitHub Sponsors, or crypto). **No $15 subscription engine yet.**
- Store `waitlist` vs `donor` / `lifetime` in a table so Phase 2 can honor it.

### Phase 1 build order

1. Paper venue + paper worker (public prices, local fills, Paper badge). **in code**
2. `DEMO=1`: no auth, no connect, paper wallet per cookie. **in code**
3. Demo host (`DEMO=1`, own Postgres). Trading UI at `tenfigures.club/app`.
4. Landing: waitlist 100 + GoFundMe. **in code** — `/` on the demo host.
5. Public repo + local README + call for devs.
6. Announce (demo, list, donate, v1 = SmartTrade, bots if funded).

### Phase 1 does not include

- Public signup / real user accounts
- Connecting Kraken / Hyperliquid / Lighter for the public
- Monthly billing
- 3Commas-style bots
- Working Ten Figures Club (tease on the landing is fine; the in-app social side is launch / Phase 2)

## Ten Figures Club (at launch)

Ships **in the app** when the hosted product launches (Phase 2), not as a later add-on and not only on the landing.

- A social side next to trading: join **Ten Figures Club** from the app.
- Members get **insights** (club feed / research — exact format still open).
- Join is in-product. Domain `tenfigures.club` is the public home; the club lives in the same app as SmartTrade.
- Phase 1 demo can tease the club; the working social surface is a **launch** item.

## Phase 2 — public OSS + paid beta

- Open-source repo is **published**.
- Hosted service with **real accounts** and secure infra. First offered as beta to the waitlist, with their free month. They **can connect exchanges**.
- **Ten Figures Club** social side is in the app at this launch: join for insights.
- After the free month: charge the floor ($5) / 50% of $15. Then normal path toward $15.
- Spend and feature work follow **what was collected** and **what users ask for**, starting with the 3Commas-like features they want most.

## Phase 3 — stable split

- Local or self-hosted OSS for whoever wants it.
- Hosted: lifetime free for donors, 50% always for early adopters, full price for others.
- Keep adding features from user demand.

## Current product (private)

Hosted single-user SmartTrade: CEX spot/futures + Hyperliquid / Lighter perps, real orders, server-side TP/SL. See `specs/product.md`.
