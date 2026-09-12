# Data

Postgres.

## exchanges

`id`, `venue`, `label`, `api_key_enc`, `api_secret_enc`, `passphrase_enc`, `created_at`, `last_ok_at`, `last_error`

Keys are AES-256-GCM with `KEY_ENCRYPTION_SECRET` (64 hex chars). Ciphertext is `iv || tag || body` base64.

## paper_balances / paper_orders

Demo only (`DEMO=1`). One paper exchange row per visitor cookie. Starting fake USDT (**$30k** cash) plus seeded in-position SmartTrades: **$10k BTC at $59,000**, **$5k ETH at $1,600**, **$2.5k XRP at $1**. Resting paper limits in `paper_orders`. Fills when the public last crosses. Never used on the live terminal.

## waitlist

Demo landing. `email` (primary key), `kind` (`waitlist` / later `donor`), `created_at`. Hard cap 100.

## smart_trades

One row per SmartTrade, Smart Cover, or simple order.

Status: `waiting_trigger` → `entry_pending` → `in_position` → `closing` → `closed` | `cancelled` | `error`.

Open statuses are polled by the worker every `WORKER_INTERVAL_MS` (default 2500).
