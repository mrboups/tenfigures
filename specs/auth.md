# Auth

Policy A on the **live** terminal: login at first touch. The process holds live trading keys and can place orders.

- Credentials: `AUTH_USERNAME`, `AUTH_PASSWORD` (Railway variables).
- `POST /api/login` sets httpOnly cookie `tradr_session` (HMAC, 7 days).
- All `/api/*` except login require that cookie.
- No user table, no signup, no OAuth.
- Change the password by changing the Railway variable; existing cookies stay valid until expiry or logout.

**Demo (`DEMO=1`)** skips login. Cookie `tradr_demo` (HMAC, 7 days) is one paper wallet per visitor. Connect-exchange is rejected. `GET /api/me` returns `{ username: "demo", demo: true }`.
