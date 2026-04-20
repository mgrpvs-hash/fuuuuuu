# Beginner Python Telegram Bot

This project is a simple, beginner-friendly Telegram bot built with
[`python-telegram-bot`](https://github.com/python-telegram-bot/python-telegram-bot).

## What this bot does

- Responds to `/start` with a welcome message
- Echoes back any text message you send
- Loads your bot token from a `.env` file

## Project files

- `bot.py` - main bot code
- `requirements.txt` - Python dependencies
- `.env.example` - example environment variables file

## Step-by-step setup and run

### 1) Create a Telegram bot and get a token

1. Open Telegram and search for **@BotFather**
2. Send `/newbot` and follow the prompts
3. Copy the token BotFather gives you (looks like `123456:ABC...`)

### 2) Install Python (if needed)

Check that Python 3.10+ is installed:

```bash
python3 --version
```

If Python is missing, install it from your package manager or from
https://www.python.org/downloads/

### 3) Create a virtual environment

From this project folder:

```bash
python3 -m venv .venv
```

Activate it:

- Linux/macOS:

  ```bash
  source .venv/bin/activate
  ```

- Windows (PowerShell):

  ```powershell
  .venv\Scripts\Activate.ps1
  ```

### 4) Install dependencies

```bash
pip install -r requirements.txt
```

### 5) Create your `.env` file

Copy the example file:

```bash
cp .env.example .env
```

Open `.env` and set your token:

```env
BOT_TOKEN=your_real_bot_token_here
```

### 6) Run the bot

```bash
python3 bot.py
```

You should see:

```text
Bot is running. Press Ctrl+C to stop.
```

### 7) Test in Telegram

1. Open your bot chat
2. Send `/start` -> you should get a welcome message
3. Send any text -> the bot should echo it back

## Stop the bot

Press `Ctrl + C` in the terminal.
