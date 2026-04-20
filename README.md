# Room Payment Telegram Bot

This project is a Telegram bot built with
[`python-telegram-bot`](https://github.com/python-telegram-bot/python-telegram-bot).
It uses inline keyboards and in-memory storage for wallet, room, and request data.

## Features

- Main menu with:
  - Connect Wallet
  - Create Room
  - My Rooms
  - Rules (empty)
- Admin-confirmed room creation payment flow
- Invite links in format: `t.me/<bot_username>?start=room_<id>`
- Creator-confirmed join payment flow
- Participant counter in rooms: `0 of 2` or `1 of 2`
- Invite link closes after first confirmed join (`max 2 people`)
- Chain behavior: confirmed joiner automatically gets their own new room
- "My Rooms" shows only rooms created by the user

## Project files

- `bot.py` - full bot logic
- `requirements.txt` - Python dependencies
- `.env.example` - environment variable template

## Quick run (no virtual environment)

```bash
python3 -m pip install --user -r requirements.txt
cp .env.example .env
# edit .env and set BOT_TOKEN
python3 bot.py
```

## Step-by-step setup

### 1) Get a bot token

1. Open Telegram and find **@BotFather**
2. Send `/newbot`
3. Copy your token

### 2) Install dependencies

```bash
python3 -m pip install --user -r requirements.txt
```

### 3) Configure `.env`

```bash
cp .env.example .env
```

Then edit `.env`:

```env
BOT_TOKEN=your_real_bot_token_here
```

### 4) Run bot

```bash
python3 bot.py
```

## How to use in Telegram

1. Send `/start`
2. Press **Connect Wallet** and send wallet address
3. Press **Create Room** and enter amount
4. Press **Confirm Payment** (admin confirms/rejects)
5. Open **My Rooms** to see rooms you created with `x of 2` status
6. Invite users using the room link
7. After one user joins and creator confirms payment:
   - that room becomes full (`1 of 2`) and link is closed
   - joiner automatically receives their own room and invite link

Stop the bot with `Ctrl + C`.
