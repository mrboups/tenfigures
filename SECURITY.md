# Security

- Exchange API keys are encrypted at rest (AES-256-GCM). The wrapping key is `KEY_ENCRYPTION_SECRET`, only in your environment / local `.env`. Never commit it.
- Keys are decrypted in memory for CCXT calls. They are never logged, never sent back to the browser, never written to git.
- Login is a username/password pair you set. Anyone with that pair can trade on connected venues.
- Create exchange keys with trade enabled and withdrawals disabled.
- Rotate `SESSION_SECRET` to drop all sessions. Rotate `KEY_ENCRYPTION_SECRET` only with a planned re-encrypt; changing it blindly makes stored keys unreadable.
- Do not set `DEMO=1` on a host that stores live keys.

Report a vulnerability to info@tenfigures.club — not as a public issue.
