# Telegram Mini App Monopoly MVP (2.5D)

Полноценный MVP multiplayer Monopoly-style игры для Telegram Web App / Mini App:

- **Backend-first логика** (античит, деньги, карты, трейды, ходы)
- **Frontend только рендерит состояние** и отправляет действия
- **Pseudo-3D доска** по периметру (без Three.js)
- Работает **локально в браузере без Telegram** для тестирования

## Стек

### Frontend
- React + TypeScript + Vite
- TailwindCSS
- Socket.IO client
- Framer Motion
- Lucide React

### Backend
- Node.js + Express + TypeScript
- Socket.IO
- Prisma ORM
- SQLite

### Структура

```text
apps/
  client/
  server/
packages/
  shared/
README.md
.env.example
```

---

## Быстрый старт

### 1) Установка

```bash
npm install
```

### 2) Настройка env

```bash
cp .env.example .env
cp apps/server/.env.example apps/server/.env
```

По умолчанию:

- API: `http://localhost:4000`
- Client: `http://localhost:5173`
- SQLite: `apps/server/prisma/dev.db`

### 3) Prisma: generate + migrate

```bash
npm run prisma:generate
npm run prisma:migrate
```

### 4) Запуск backend

```bash
npm run dev:server
```

### 5) Запуск frontend

В отдельном терминале:

```bash
npm run dev:client
```

Открыть:

- `http://localhost:5173`

---

## Локальный тест в браузере (без Telegram)

1. Откройте `http://localhost:5173`
2. Создайте комнату с `entryFee` и `maxPlayers`
3. Откройте вторую/третью вкладку браузера
4. Войдите в ту же комнату по коду
5. Запустите игру и тестируйте multiplayer:
   - кубики
   - покупка/улучшение/выкуп улиц
   - щиты
   - карты
   - трейды
   - debt mode / продажу / банкротство

> Для удобного теста нескольких игроков используйте разные браузеры/профили, чтобы получить разные local player IDs.

---

## API (REST)

- `POST /api/rooms/create`
- `POST /api/rooms/join`
- `POST /api/rooms/start`
- `GET /api/rooms`
- `GET /api/rooms/:code`
- `GET /api/leaderboard`
- `GET /api/profile/:id`

## Socket.IO events

Входящие (client -> server):

- `room:join`
- `game:start`
- `dice:roll`
- `turn:end`
- `property:buy`
- `property:upgrade`
- `property:buyout`
- `property:sell`
- `shield:place`
- `jail:pay`
- `jail:roll`
- `jail:use_card`
- `card:draw`
- `trade:create`
- `trade:accept`
- `trade:reject`
- `trade:counter`
- `trade:cancel`

Исходящие (server -> client):

- `game:update`
- `game:error`

---

## Telegram Mini App интеграция (после MVP)

Текущий MVP уже поддерживает запуск внутри Telegram WebApp:

- клиент читает `window.Telegram.WebApp.initDataUnsafe.user`
- при отсутствии Telegram использует local fallback-identity

### Подключение через ngrok

1. Поднимите backend + frontend локально
2. Пробросьте frontend через ngrok:
   ```bash
   ngrok http 5173
   ```
3. Укажите HTTPS URL в настройках Mini App в BotFather
4. Бот используется только как кнопка **«Играть»**, вся игровая логика живет на backend

---

## Важные правила реализации

- Frontend не считает экономику и не валидирует ход как источник истины
- Dice/cards/money/trades проверяются только сервером
- Экономические изменения выполняются на backend (Prisma + server authority)
- Доска — замкнутый маршрут по периметру, центр используется под кубики и статус
