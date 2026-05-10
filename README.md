# Monopoly Premium — Telegram Mini App (MVP)

Полноценная multiplayer-игра в стиле Monopoly как Telegram Web App (Mini App).

- **Это не бот**: весь UI работает как веб-приложение.
- **Вся игровая логика на backend** (Socket.IO + TypeScript).
- **Frontend** только отображает состояние и отправляет действия.

## Технологии

### Frontend
- React + TypeScript + Vite
- TailwindCSS
- Socket.IO client

### Backend
- Node.js + Express + TypeScript
- Socket.IO
- Prisma
- SQLite (MVP)

## Дизайн

Премиальный классический стиль:
- тёмный фон (`#0B1E16`, `#07130E`)
- панели (`#122821`)
- границы (`#1F3D33`)
- золото (`#FBBF24`, `#D4A017`)
- зелёный акцент (`#22C55E`)
- ошибки (`#EF4444`)
- шрифт **Inter** (SemiBold для заголовков, Regular для текста)

Валюта отображается в формате:
- `🪙 1200`

## Основная механика

- Комнаты: `entryFee`, `maxPlayers` (2–6)
- Вход в комнату списывает средства, выход до старта возвращает
- `startingBalance = entryFee`
- `multiplier = entryFee / 1000` (масштабирует цены/аренду/налоги)
- Кости: 2 кубика, дубль = доп. ход, 3 дубля = тюрьма
- Тюрьма: оплата / дубль / карта
- Улицы:
  - улучшение без полного набора цвета
  - при полном цвете аренда x2
  - уровни 0..5: пусто → дом → большой дом → отель → luxury → palace 👑
- Выкуп:
  - `buyoutPrice = price + upgrades * 1.7 + price * 0.5`
  - если есть Shield: первый удар снимает Shield
- Shield:
  - 1 щит на улицу
  - защищает от выкупа и разрушения
- Debt mode и банкротство:
  - при балансе < 0 автоматически распродаются активы
  - если долг не закрыт — банкрот и вылет
- Раунды:
  - `Раунд X / 30`
  - конец игры: 1 игрок остался или 30 раундов
- Выплаты:
  - 1 место — 100%
  - 2 место — 98%
  - 3 место — 95%
  - 4+ — 90%
  - банкрот — 0

## Лидерборд

- По победам
- По прибыли

`profit = payout - entryFee`

## Структура проекта

```text
apps/
  client/   # Telegram Mini App (React + Vite + Tailwind)
  server/   # API + Socket.IO + Game Engine + Prisma
```

## Установка

```bash
npm install
```

## Настройка окружения

### Backend

```bash
cp apps/server/.env.example apps/server/.env
```

### Frontend

```bash
cp apps/client/.env.example apps/client/.env
```

## Инициализация БД (Prisma + SQLite)

```bash
cd apps/server
DATABASE_URL="file:./dev.db" npm run prisma:migrate
cd ../..
```

## Запуск в dev-режиме

Из корня:

```bash
npm run dev
```

По умолчанию:
- backend: `http://localhost:3001`
- frontend: `http://localhost:5173`

## Прод-сборка

```bash
npm run build
```

## Тест мультиплеера локально

1. Запустить `npm run dev`
2. Открыть frontend в 2-4 вкладках/браузерах
3. В каждой вкладке создать/инициализировать профиль
4. Один игрок:
   - создаёт комнату (entryFee, maxPlayers)
5. Остальные:
   - входят по коду комнаты
6. Хост стартует игру
7. Проверить:
   - броски кубиков
   - покупку/улучшение улиц
   - аренду и выкуп
   - щиты
   - debt mode / банкротство
   - трейды
   - финал и выплаты

## Запуск как Telegram Mini App через ngrok

1. Запустить backend:

```bash
cd apps/server
npm run dev
```

2. Запустить frontend:

```bash
cd apps/client
npm run dev -- --host
```

3. Поднять туннели ngrok:

```bash
ngrok http 5173
ngrok http 3001
```

4. В `apps/client/.env` подставить публичный URL backend:

```env
VITE_API_URL=https://your-backend.ngrok-free.app
VITE_SOCKET_URL=https://your-backend.ngrok-free.app
```

5. В BotFather указать Web App URL на frontend ngrok.

## Socket-события (основные)

Client -> Server:
- `room:create`
- `room:join`
- `room:leave`
- `room:start`
- `game:roll`
- `game:buyProperty`
- `game:upgradeProperty`
- `game:applyShield`
- `game:buyout`
- `game:payJail`
- `game:useJailCard`
- `game:endTurn`
- `game:tradePropose`
- `game:tradeRespond`

Server -> Client:
- `rooms:update`
- `room:update`
- `game:actions`
- `app:error`

## Примечания

- MVP хранит БД в SQLite.
- Для production желательно вынести in-memory комнаты/матчи в Redis + durable storage.
