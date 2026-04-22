# PyraLink bot (aiogram 3 + PostgreSQL + Redis)

Проект полностью переписан с python-telegram-bot на aiogram 3.x.

Реализовано:

- логика комнат `0/2 -> 1/2 -> 2/2`;
- цепочка: после успешного присоединения пользователю автоматически создается своя комната;
- подтверждение оплаты участника только создателем комнаты;
- хранение состояния в PostgreSQL (после перезапуска ничего не теряется);
- Redis подключен и используется приложением;
- админ-команды:
  - `/stats`
  - `/rooms`
  - `/ban <user_id>`
  - `/unban <user_id>`
  - `/block_room <room_id_or_token>`
  - `/unblock_room <room_id_or_token>`
  - `/broadcast <text>`
  - `/debug_room <room_id_or_token>`
  - `/chain <user_id>`
  - `/my_id`

## Запуск

```bash
cp .env.example .env
docker-compose up --build
```

## Файлы проекта

- `app/main.py` - запуск бота
- `app/config.py` - конфиг из env
- `app/db.py` - SQLAlchemy engine/session/init
- `app/models.py` - модели БД
- `app/repositories.py` - доступ к данным
- `app/services.py` - вспомогательная бизнес-логика
- `app/handlers.py` - команды, callback и весь flow
- `app/keyboards.py` - inline клавиатуры
- `app/constants.py` - правила и константы
- `app/utils.py` - утилиты форматирования/парсинга
