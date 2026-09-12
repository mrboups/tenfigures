# Contributing

Issues first. Describe the bug or the feature; include the venue and a pair when it is a trading bug.

## Run

```bash
cp .env.example .env
npm install
npm test
npm run dev
```

Do not commit `.env`, API keys, session secrets, or exchange credentials.

## Scope

- English UI.
- Tests for engine, paper fills, session, and waitlist stay green (`npm test`).
- User-requested work is prioritized when the project is funded.

Pull requests: one change, a short why, and tests when the behavior is logic not layout.
