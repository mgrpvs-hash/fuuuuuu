# Production Deployment Guide

## 1. Requirements
- Docker 24+
- Public HTTPS domain for Telegram webhook
- Reverse proxy / ingress with TLS (Nginx, Traefik, Cloudflare Tunnel, etc.)
- Instagram Graph API credentials and public media host

## 2. Configure environment
Create `.env` from `.env.example` and set:

- `NODE_ENV=production`
- `TELEGRAM_BOT_MODE=webhook`
- `TELEGRAM_WEBHOOK_DOMAIN=https://bot.yourdomain.com`
- `TELEGRAM_WEBHOOK_PATH=/telegram/webhook`
- `TELEGRAM_WEBHOOK_SECRET_TOKEN=<long-random-secret>`
- `MEDIA_PUBLIC_BASE_URL=https://cdn.yourdomain.com/media`
- OpenAI/Instagram tokens

Important:
- `TELEGRAM_WEBHOOK_DOMAIN` must be public HTTPS.
- `MEDIA_PUBLIC_BASE_URL` must provide publicly accessible media URLs.

## 3. Build and run
```bash
docker compose build
docker compose up -d
```

Check logs:
```bash
docker compose logs -f
```

## 4. Telegram webhook hardening
- Use strong `TELEGRAM_WEBHOOK_SECRET_TOKEN`.
- Restrict inbound traffic at proxy/WAF to Telegram IP ranges where possible.
- Terminate TLS at reverse proxy and forward to container.

## 5. Operational checklist
1. Ensure the service starts with no env validation errors.
2. Send `/start` to bot and verify command responses.
3. Run end-to-end flow with test media:
   - media upload
   - AI generation
   - approve/schedule
   - publish log entry in DB
4. Verify scheduler publishes due posts.
5. Verify rate limiting and safety warnings are triggered.

## 6. Scaling considerations
- Current session/rate-limit storage is in-memory per instance.
- For horizontal scale, migrate to Redis for:
  - sessions,
  - rate limits,
  - distributed locks for scheduled jobs.
- Move from SQLite to PostgreSQL for concurrent production load.

## 7. Incident handling
- If Instagram API returns transient failures (429/5xx), built-in retry is applied.
- If failures persist, posts are marked `failed` and errors are written to `publish_logs`.
- Re-run via regenerate + approve flow in Telegram after root-cause fix.
