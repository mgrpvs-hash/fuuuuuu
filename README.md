# Clinic Instagram Automation (Production-Oriented MVP)

Система автоматизированного ведения Instagram медицинской клиники через Telegram-бота с обязательным human approval.

## Основные возможности
- Прием фото/видео/описания через Telegram.
- Генерация медицински аккуратного контента через OpenAI:
  - 2–3 caption,
  - hashtags,
  - CTA,
  - текст для stories,
  - идея для reels.
- Medical safety проверки:
  - до AI-генерации,
  - до публикации.
- Approval workflow:
  - Approve now / Regenerate / Schedule / Cancel.
- Публикация в Instagram Graph API (post/reel/story по доступности API).
- Логи публикаций и статусы в БД.
- Scheduler для отложенных публикаций.
- Webhook mode для Telegram (production default).

---

## Архитектура

### Поток
1. Telegram user отправляет медиа + текст.
2. Бот валидирует медиа и ограничивает частоту запросов (rate limit).
3. Safety layer анализирует рискованные claims.
4. OpenAI генерирует structured JSON-контент по system/user prompts.
5. Draft сохраняется в БД.
6. Пользователь подтверждает публикацию вручную.
7. Перед публикацией выполняется финальный safety check + дисклеймер.
8. Instagram service публикует через Graph API с retry/backoff.
9. Результаты пишутся в `publish_logs`.

### Компоненты
- `src/bot/bot.ts` — Telegram UX, handlers, middleware, approvals.
- `src/services/openai.service.ts` — structured AI generation.
- `src/services/safety.service.ts` — safety policy + edge-case checks.
- `src/services/instagram.service.ts` — Graph API integration + retry logic.
- `src/services/content-workflow.service.ts` — approve/schedule/publish orchestration.
- `src/services/scheduler.service.ts` — cron processing.
- `src/services/rate-limit.service.ts` — in-memory user throttling.
- `src/services/media-validation.service.ts` — media validation.
- `src/db/database.ts`, `src/db/schema.sql` — persistence layer.
- `src/config/env.ts` — strict env validation.
- `src/utils/logger.ts` — structured logging.

---

## Структура проекта

```text
src/
  bot/
    bot.ts
  config/
    env.ts
  db/
    database.ts
    schema.sql
  prompts/
    schemas/
      content-generation.schema.ts
    system/
      medical-content.system.prompt.ts
    user/
      content-generation.user.prompt.ts
  services/
    content-workflow.service.ts
    instagram.service.ts
    media-validation.service.ts
    openai.service.ts
    rate-limit.service.ts
    safety.service.ts
    scheduler.service.ts
  types/
    domain.ts
    errors.ts
  utils/
    fs.ts
    logger.ts
    retry.ts
  index.ts

docs/
  production-deployment.md
```

---

## Telegram команды
- `/start`
- `/help`
- `/settings`
- `/set_tone <tone>`
- `/set_language <ru|en>`
- `/connect_instagram <instagram_business_account_id>`
- `/drafts`
- `/scheduled`

---

## Запуск локально

### Требования
- Node.js 20+
- npm

### Установка
```bash
npm install
cp .env.example .env
```

### Важно для webhook mode
По умолчанию включен `TELEGRAM_BOT_MODE=webhook`, поэтому нужен публичный HTTPS domain.
Для локального старта без публичного домена можно временно переключить:

```env
TELEGRAM_BOT_MODE=polling
```

### Запуск
```bash
npm run dev
```

### Проверки
```bash
npm run check
npm run build
```

---

## Docker

### Build + Run
```bash
docker compose build
docker compose up -d
```

Логи:
```bash
docker compose logs -f
```

---

## Meta Developer permissions

Минимально:
- `instagram_basic`
- `instagram_content_publish`
- `pages_show_list`
- `pages_read_engagement`
- `business_management` (зависит от схемы доступа)

Также нужен Instagram Business/Creator account, связанный с Facebook Page.

---

## Ограничения текущего этапа
- SQLite вместо PostgreSQL.
- In-memory rate-limit/sessions (без Redis).
- Scheduler на node-cron без distributed lock.
- OAuth для Instagram не реализован (токены через `.env`).

---

## Safety policy (обязательно)
- Запрещены диагнозы и обещания результата.
- Запрещены абсолютные claims (`100%`, `гарантированно`, `без риска`, `полностью вылечит` и т.д.).
- Обязателен human approval перед публикацией.
- При медицинских советах добавляется дисклеймер.

---

## Продакшен-гайд

См. `docs/production-deployment.md`.
# fuuuuuu
