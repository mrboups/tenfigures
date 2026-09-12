# Guardrails

1. Authenticated session required for every trading call on the live terminal. Demo uses a visitor cookie and a paper wallet only.
2. Exchange keys tested live before insert.
3. Withdrawals must stay off on the venue key (operator-enforced).
4. Confirm modal in the UI before create.
5. Min amount / min notional from the venue markets, not guessed.
6. Stop-loss is evaluated before take-profit on the same tick.
7. Open trades block deleting the exchange account.
8. Worker errors are stored on the trade (`last_error`) and do not crash the loop.
9. Fail closed: invalid payload or missing market → 400, no order.
