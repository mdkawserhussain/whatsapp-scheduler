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
- **Holiday skip**: Skips Bangladesh national holidays (2025-2030)
- **Editable templates**: Change messages without touching code
- **Voice fallback chain**: OGG → MP3 → Edge-TTS auto-generation
- **Telegram alerts**: Optional notifications on send success/failure
- **Startup validation**: Catches misconfiguration before first send
- **Crash recovery**: VBS launcher auto-restarts on crash (5 retries)
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

### Startup Validation

On every start, the system checks:
- Node.js version ≥ 18
- `.env` exists and phone number is not placeholder
- All 4 message templates exist in `messages/`
- Cron expressions are valid
- Voice file exists (warning only — not blocking)

## Message Templates

Messages are stored in `messages/*.txt` — edit these files to change what gets sent.

| File | Schedule | Purpose |
|------|----------|---------|
| `morning-text.txt` | 09:30 | Full accounting notice |
| `morning-voice.txt` | 10:00 | Voice generation source text |
| `afternoon-text.txt` | 14:00 | Afternoon check-in |
| `afternoon-voice.txt` | 14:30 | Voice generation source text |

**Note:** Templates are loaded once at startup. Edit a file → restart the scheduler to apply.

## Voice Notes

The system uses a **fallback chain** — it tries each option in order until one works:

```
1. voice.ogg exists?  → use it directly
2. voice.mp3 exists?  → convert to .ogg via ffmpeg, use it
                       → if ffmpeg fails, use .mp3 directly
3. Neither?           → generate via Edge-TTS (if installed)
                       → uses text from morning-voice.txt
4. All fail?          → skip voice send, log error
```

### Option A: Place a pre-recorded file

```bash
# OGG/Opus (preferred — WhatsApp native format)
ffmpeg -i input.mp3 -c:a libopus -b:a 32k -ac 1 voice.ogg

# Or just place voice.mp3 — it auto-converts
```

### Option B: Generate with Edge-TTS (free)

```bash
# Install edge-tts (Python)
pip install edge-tts

# Generate voice.ogg from morning-voice.txt
node generate-voice.js
```

### Option C: Do nothing

If no voice file exists and Edge-TTS is installed, the system auto-generates one on first voice send.

## Anti-Ban Features

- **Random jitter**: 0-120s delay before each send
- **Holiday skip**: Automatically skips Bangladesh national holidays (2025-2030)
- **Dynamic messages**: Edit templates to vary content
- **Exponential backoff**: On reconnect, waits 10s → 20s → 40s → ... → 300s max
- **Startup validation**: Catches invalid config before first cron fire

### Holidays

Edit `holidays.json` to add/remove holidays. Current coverage: 2025-2030.

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
- **Rotation**: Auto-rotates at 5MB (checked every 100 writes)
- **Format**: `[date] LEVEL message`
- **Write errors**: Surfaced to console (not silently swallowed)

## Running as a Service

### Option A: VBS background launcher (recommended)

Double-click `start.vbs` — runs invisibly in background with auto-restart (5 retries, 30s delay between crashes).

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
| Voice file not found | Place `voice.ogg` or `voice.mp3`, or install Edge-TTS |
| Cron not firing | Check `.env` schedule format and timezone |
| Session expired | Delete `.wwebjs_auth/`, restart, re-scan QR |
| `MODULE_NOT_FOUND` | Run `npm install` |
| "Target phone still placeholder" | Edit `.env` and set real phone number |

## File Structure

```
whatsapp-scheduler/
├── index.js              # Main scheduler + voice fallback chain
├── config.js             # Config loader (.env)
├── templates.js          # Message template loader
├── logger.js             # Structured logging with rotation
├── notifications.js      # Telegram notifications
├── validate.js           # Startup validation (Node, deps, config, cron)
├── tts.js                # Edge-TTS wrapper (MP3 → OGG conversion)
├── generate-voice.js     # One-time voice generation script
├── package.json          # Dependencies (4 packages)
├── .env                  # Your settings (git-ignored)
├── .env.example          # Template settings
├── holidays.json         # Bangladesh holidays (2025-2030)
├── messages/             # Editable message templates
│   ├── morning-text.txt
│   ├── morning-voice.txt
│   ├── afternoon-text.txt
│   └── afternoon-voice.txt
├── voice.ogg             # Voice note (auto-generated if missing)
├── scheduler.log         # Log file (auto-generated)
├── setup.bat             # One-click setup
├── start.vbs             # Silent launcher with crash recovery
└── .wwebjs_auth/         # WhatsApp session (git-ignored)
```
