# WhatsApp Accounts Notice Scheduler

Fire-and-forget WhatsApp scheduler for sending daily accounting notices. Set it up once, never touch it again.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Message Templates](#message-templates)
- [Voice Notes](#voice-notes)
- [Anti-Ban Features](#anti-ban-features)
- [Telegram Notifications](#telegram-notifications)
- [Logging](#logging)
- [Running as a Service](#running-as-a-service)
- [Troubleshooting](#troubleshooting)
- [File Structure](#file-structure)

## Features

- **Fire-and-forget**: Set up once, runs forever
- **4 daily messages**: 09:30 text, 10:00 voice, 14:00 text, 14:30 voice
- **Auto-reconnect**: Exponential backoff on disconnects
- **Anti-ban jitter**: Random 0-120s delay on sends
- **Holiday skip**: Skips Bangladesh national holidays
- **Editable templates**: Change messages without touching code
- **Telegram alerts**: Optional notifications on send success/failure
- **Structured logging**: With file rotation and log levels

## Quick Start

```bash
# 1. Run setup (installs dependencies, creates .env)
setup.bat

# 2. Edit .env with your settings
notepad .env

# 3. First run — scan QR code
node index.js

# 4. After QR scan, Ctrl+C, then run in background
start.vbs
```

## Configuration

All settings are in `.env`. Copy `.env.example` to get started.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TARGET_PHONE` | Yes | — | Recipient number: `8801XXXXXXXXX@c.us` |
| `TIMEZONE` | No | `Asia/Dhaka` | Timezone for cron schedules |
| `MORNING_TEXT_CRON` | No | `30 9 * * *` | Morning text schedule |
| `MORNING_VOICE_CRON` | No | `0 10 * * *` | Morning voice schedule |
| `AFTERNOON_TEXT_CRON` | No | `0 14 * * *` | Afternoon text schedule |
| `AFTERNOON_VOICE_CRON` | No | `30 14 * * *` | Afternoon voice schedule |
| `VOICE_FILE` | No | `voice.ogg` | Voice note filename |
| `TELEGRAM_BOT_TOKEN` | No | — | Telegram bot token |
| `TELEGRAM_CHAT_ID` | No | — | Telegram chat ID |
| `LOG_LEVEL` | No | `info` | Log level: debug/info/warn/error |
| `LOG_FILE` | No | `scheduler.log` | Log file path |

## Message Templates

Messages are stored in `messages/*.txt` — edit these files to change what gets sent.

| File | Schedule | Purpose |
|------|----------|---------|
| `morning-text.txt` | 09:30 | Full accounting notice |
| `morning-voice.txt` | 10:00 | Short voice reminder |
| `afternoon-text.txt` | 14:00 | Afternoon check-in |
| `afternoon-voice.txt` | 14:30 | Evening reminder |

### Placeholders

Use `{variable}` in templates. Available variables:
- `{yesterday}` — Yesterday's date
- `{today}` — Today's date
- `{tomorrow}` — Tomorrow's date

## Voice Notes

### Option A: Pre-recorded file

Place `voice.ogg` (OGG/Opus format) in the project folder.

```bash
# Convert MP3 to OGG/Opus
ffmpeg -i input.mp3 -c:a libopus -b:a 32k -ac 1 voice.ogg
```

### Option B: Generate with Edge-TTS (free)

```bash
# Install edge-tts
pip install edge-tts

# Generate voice file
node generate-voice.js
```

## Anti-Ban Features

- **Random jitter**: 0-120s delay before each send
- **Holiday skip**: Automatically skips Bangladesh national holidays
- **Dynamic messages**: Edit templates to vary content
- **Exponential backoff**: On reconnect, waits 10s → 20s → 40s → ... → 300s max

### Holidays

Edit `holidays.json` to add/remove holidays:

```json
{
  "2026-03-26": "Independence Day",
  "2026-12-16": "Victory Day"
}
```

## Telegram Notifications

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Get your chat ID via [@userinfobot](https://t.me/userinfobot)
3. Add to `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
   TELEGRAM_CHAT_ID=987654321
   ```

## Logging

Logs are written to both console and `scheduler.log`.

- **Log levels**: debug, info, warn, error
- **Rotation**: Auto-rotates at 5MB
- **Format**: `[date] LEVEL message`

## Running as a Service

### Option A: VBS background launcher

Double-click `start.vbs` — runs invisibly in background.

### Option B: Windows Startup

1. Press `Win + R` → type `shell:startup` → Enter
2. Create a shortcut to `start.vbs` in that folder

### Option C: PM2 (recommended for production)

```bash
npm install -g pm2
pm2 start index.js --name whatsapp-scheduler
pm2 save
pm2 startup
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| QR code not appearing | Delete `.wwebjs_auth/` and restart |
| "Client not ready" | Wait for "✅ WhatsApp client ready" in logs |
| Voice file not found | Place `voice.ogg` in project folder |
| Cron not firing | Check `.env` schedule format and timezone |
| Session expired | Delete `.wwebjs_auth/`, restart, re-scan QR |

## File Structure

```
whatsapp-scheduler/
├── index.js              # Main scheduler
├── config.js             # Config loader (.env)
├── templates.js          # Message template loader
├── logger.js             # Structured logging
├── notifications.js      # Telegram notifications
├── validate.js           # Startup validation
├── tts.js                # Edge-TTS wrapper
├── generate-voice.js     # Voice generation script
├── .env                  # Your settings (git-ignored)
├── .env.example          # Template settings
├── holidays.json         # Bangladesh holidays
├── messages/             # Editable message templates
│   ├── morning-text.txt
│   ├── morning-voice.txt
│   ├── afternoon-text.txt
│   └── afternoon-voice.txt
├── voice.ogg             # Voice note file
├── scheduler.log         # Log file (auto-generated)
├── setup.bat             # One-click setup
├── start.vbs             # Silent background launcher
└── .wwebjs_auth/         # WhatsApp session (git-ignored)
```
