# CODEX IMPORT GUIDE

## Codex CLI

1. Clone repository.
2. Copy `.secrets/codex.env.local` to `.env`.
3. Run `npm install`.
4. Run `npm run check`.
5. Run `npm run build`.
6. Run `npm run test:instagram`.
7. Run `npm run test:storage`.
8. Run `npm run test:telegram`.
9. Run `npm run dev`.

---

## Codex Web / Cloud

1. Connect the GitHub repository.
2. Create a Codex environment for this project.
3. Add environment variables/secrets manually from `.secrets/codex.env.local` into Codex Environment Variables / Secrets.
4. Use setup script: `npm install`.
5. Run tests.
6. Do not use Codex Cloud as permanent Telegram bot hosting.

