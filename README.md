# Room Payment Bot (aiogram + PostgreSQL + Redis)

Промышленная версия Telegram-бота на **aiogram 3.x** с:

- PostgreSQL + SQLAlchemy + Alembic (персистентные данные)
- Redis (FSM + кеш)
- Webhook режимом
- Docker + Docker Compose

Все ключевые сценарии сохранены:

- русскоязычный интерфейс и эмодзи
- логика комнат `0 -> 1 -> 2`
- цепочка (после подтверждения joiner получает свою комнату)
- подтверждение создания комнат админом
- подтверждение входа создателем комнаты
- админ-команды для двух админов (`ADMIN_ID`, `ADMIN_ID_2`)
- токены ссылок (`room_<8-char-token>`)

## Структура проекта

```text
app/
  cache/redis.py
  config.py
  db/
    base.py
    models.py
    session.py
  handlers/
    admin.py
    user.py
  middlewares/db.py
  services/
    logic.py
    repositories.py
    state.py
  keyboards.py
  main.py
alembic/
  env.py
  script.py.mako
  versions/
    20260420_0001_initial_schema.py
Dockerfile
docker-compose.yml
alembic.ini
requirements.txt
```

## Быстрый запуск через Docker

1. Скопируйте env:

```bash
cp .env.example .env
```

2. Заполните обязательные переменные в `.env`:

- `BOT_TOKEN`
- `BOT_USERNAME` (например, `PyraLink_bot`)
- `WEBHOOK_BASE_URL` (публичный HTTPS URL)
- `WEBHOOK_SECRET`

3. Поднимите сервисы:

```bash
docker compose up -d --build
```

4. Проверьте логи бота:

```bash
docker compose logs -f bot
```

## Локальный запуск без Docker (при наличии PostgreSQL/Redis)

```bash
python3 -m pip install --user -r requirements.txt
cp .env.example .env
alembic upgrade head
python3 -m app.main
```

## Миграции

Применить миграции:

```bash
alembic upgrade head
```

Создать новую миграцию:

```bash
alembic revision -m "your migration name"
```

## Вебхук

- Endpoint: `WEBHOOK_PATH` (по умолчанию `/webhook`)
- URL: `WEBHOOK_BASE_URL + WEBHOOK_PATH`
- Secret token: `WEBHOOK_SECRET`

Бот на старте устанавливает webhook автоматически.
