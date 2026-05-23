# Clinic Instagram Automation MVP (Telegram + AI + Instagram)

MVP-система автоматизации контента для Instagram медицинской клиники через Telegram-бота.

## 1) Архитектура MVP

### Поток данных
1. Пользователь отправляет в Telegram-бот медиа (фото/видео) + описание.
2. Бот запрашивает тип контента (`post` / `reel` / `story`) и язык (`ru` / `en`).
3. `SafetyService` проверяет входной текст на рискованные медицинские формулировки.
4. `OpenAiService` генерирует:
   - 2–3 caption;
   - hashtags;
   - CTA;
   - текст для story;
   - идею для Reels (если есть видео);
   - risk warning / safer hint при необходимости.
5. Черновик сохраняется в БД со статусом `draft`.
6. Бот показывает результат и кнопки:
   - `Approve now`;
   - `Regenerate`;
   - `Schedule`;
   - `Cancel`.
7. Перед публикацией выполняется повторный safety-check и добавление медицинского дисклеймера.
8. Публикация идет через Instagram Graph API.
9. Результаты/ошибки пишутся в `publish_logs`, статусы обновляются (`published` / `failed`).

### Компоненты
- **Telegram layer** (`src/bot/bot.ts`) — UX, команды, callback-кнопки, сбор медиа/описания.
- **AI layer** (`src/services/openai.service.ts`) — генерация контента OpenAI API.
- **Medical Safety layer** (`src/services/safety.service.ts`) — фильтр рискованных формулировок.
- **Publishing layer** (`src/services/instagram.service.ts`) — Instagram Graph API.
- **Workflow layer** (`src/services/content-workflow.service.ts`) — approve/schedule/publish логика.
- **Scheduler layer** (`src/services/scheduler.service.ts`) — отложенные публикации через `node-cron`.
- **Persistence layer** (`src/db/database.ts`, `src/db/schema.sql`) — SQLite для MVP.
- **Config layer** (`src/config/env.ts`) — валидация env через `zod`.

## 2) Пошаговый план реализации

1. Создать проект Node.js + TypeScript и базовую структуру папок.
2. Настроить `.env` и валидацию конфигурации.
3. Реализовать SQLite schema и DB-репозиторий.
4. Реализовать SafetyService (до генерации и до публикации).
5. Реализовать OpenAI генератор с JSON-форматом ответа.
6. Реализовать Telegram-бота:
   - прием фото/видео;
   - прием описания;
   - выбор типа контента/языка;
   - approval workflow.
7. Реализовать публикацию в Instagram Graph API + обработку ошибок.
8. Реализовать scheduler для `Schedule`.
9. Добавить команды `/settings`, `/set_tone`, `/set_language`, `/drafts`, `/scheduled`.
10. Проверить сборку TypeScript и базовые сценарии.

## 3) Структура проекта

```text
src/
  bot/
    bot.ts
  services/
    content-workflow.service.ts
    instagram.service.ts
    openai.service.ts
    safety.service.ts
    scheduler.service.ts
  db/
    database.ts
    schema.sql
  prompts/
    content.prompt.ts
  utils/
    fs.ts
    logger.ts
  config/
    env.ts
  types/
    domain.ts
  index.ts
```

## 4) Команды Telegram (MVP)

- `/start`
- `/help`
- `/settings`
- `/set_tone <tone>`
- `/set_language <ru|en>`
- `/connect_instagram <instagram_business_account_id>`
- `/drafts`
- `/scheduled`

## 5) Запуск локально

### Требования
- Node.js 20+
- npm

### Установка
```bash
npm install
cp .env.example .env
```

Заполните `.env`:
- `TELEGRAM_BOT_TOKEN`
- `OPENAI_API_KEY`
- `INSTAGRAM_ACCESS_TOKEN`
- `INSTAGRAM_BUSINESS_ACCOUNT_ID`
- `MEDIA_PUBLIC_BASE_URL` (публичный URL для медиа-файлов, так как Graph API не принимает локальные пути)

### Запуск
```bash
npm run dev
```

Сборка:
```bash
npm run build
npm start
```

## 6) Meta Developer API permissions (минимум для MVP)

Для Instagram Graph API обычно требуются:
- `instagram_basic`
- `instagram_content_publish`
- `pages_show_list`
- `pages_read_engagement`
- `business_management` (в зависимости от схемы доступа)

Также нужны:
- Facebook Page, связанная с Instagram Business/Creator account.
- Действительный long-lived access token.

## 7) Ограничения MVP

1. Нет полноценного OAuth для Instagram (токены из `.env`).
2. SQLite вместо PostgreSQL (подходит для MVP, но не для high-load).
3. Публикация медиа требует **публично доступного URL** (`MEDIA_PUBLIC_BASE_URL`); локального файла недостаточно для Graph API.
4. Safety-слой в MVP гибридный (правила + AI), не заменяет юридический/compliance review.
5. Нет веб-панели администратора, только Telegram.
6. Нет очереди BullMQ/Redis (используется `node-cron`).
7. Нет многоуровневой модерации, только single human approval.

## 8) Что вынести во второй этап

1. Instagram OAuth 2.0 + token refresh lifecycle.
2. Переход на PostgreSQL + Prisma migration flow.
3. S3/Cloud Storage + signed URLs для надежной доставки медиа.
4. BullMQ + Redis для надежного job processing/retries/DLQ.
5. Ролевая модель и multi-approver workflow.
6. Расширенный medical compliance policy engine и аудит-трейл.
7. A/B тестирование caption-вариантов и аналитика эффективности постов.
8. Web admin dashboard + observability (metrics, traces, alerts).

## 9) Важные правила medical safety в MVP

- Нельзя ставить диагнозы.
- Нельзя обещать результат лечения.
- Нельзя использовать абсолютные claims (`100%`, `гарантированно`, `без риска`, `полностью вылечит`).
- Перед публикацией обязателен human approval.
- Для медицинских советов добавляется дисклеймер:
  - RU: `Информация носит ознакомительный характер и не заменяет консультацию специалиста.`
  - EN: `This information is for educational purposes only and does not replace consultation with a licensed clinician.`
# fuuuuuu
