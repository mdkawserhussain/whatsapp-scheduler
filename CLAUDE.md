# CLAUDE.md — Project Context (Auto-Evolving)

> **Last updated:** 2026-06-18
> **Session:** Post-audit bug fixes + voice fallback chain

---

## Project Overview

**WhatsApp Accounts Notice Scheduler** — fire-and-forget WhatsApp bot that sends daily accounting notices (Bengali) to a single recipient. Runs on Windows, uses whatsapp-web.js with Puppeteer/Chromium.

**Audience:** Single developer/administrator (Hishab accounting team)
**Repo:** https://github.com/mdkawserhussain/whatsapp-scheduler

---

## Architecture

```
index.js            ← Single entry point, orchestrates everything
├── config.js       ← Loads .env via dotenv, validates required vars
├── templates.js    ← Reads messages/*.txt files into memory
├── logger.js       ← Structured logging with rotation (5MB, every 100 writes)
├── notifications.js ← Telegram alerts (optional, no-ops if no token)
├── validate.js     ← Startup checks (Node version, deps, config, cron)
├── tts.js          ← Edge-TTS wrapper (MP3 → OGG via ffmpeg)
└── messages/*.txt  ← Editable Bengali message templates
```

**Key design decisions:**
- Single entry point — no microservices, no build step
- CommonJS (`require`) — not ESM
- Config from `.env` — no config files in code
- Templates loaded once at startup — restart required to reload
- Voice: ogg → mp3 → edge-tts fallback chain
- Cron: node-cron v4 with timezone support (`Asia/Dhaka`)

---

## Conventions

- **Language:** CommonJS (`module.exports`, `require`)
- **Style:** `'use strict'` at top of every file
- **Naming:** camelCase for variables/functions, PascalCase for classes
- **Logging:** Use `log()` function (wraps logger.info) — writes to console + file
- **Error handling:** Try/catch with log + optional Telegram notification
- **No comments** in code unless explicitly asked
- **File structure:** One module per file, flat (no src/ subdirectories)

---

## Gotchas

1. **Zombie Chromium** — If `node index.js` crashes, kill with `taskkill /F /IM chrome.exe /T` before restarting
2. **Session lock** — `.wwebjs_auth/` locks to one process. Second instance crashes.
3. **Templates are static** — Editing `messages/*.txt` requires restart to take effect
4. **Voice fallback** — If no `voice.ogg` or `voice.mp3`, it auto-generates via Edge-TTS (requires `pip install edge-tts`)
5. **Phone format** — Must be `8801XXXXXXXXX@c.us` (no `+`, no spaces, `@c.us` not `@s.whatsapp.net`)
6. **Holiday dates** — `holidays.json` only covers 2025-2030. Update before 2030.
7. **Cron validation** — Invalid cron in `.env` crashes at startup (this is intentional)
8. **start.vbs** — Runs hidden, auto-restarts 5 times with 30s delay. Check `scheduler.log` to see if it's alive.

---

## Current State

**Version:** 2.0.0
**Status:** Production-ready, tested with real WhatsApp
**Last deployed:** 2026-06-18

### Dependencies (package.json)
- whatsapp-web.js@^1.34.7
- node-cron@^4.3.0
- qrcode-terminal@^0.12.0
- dotenv@^17.4.2

### Cron Schedule
| Time | Type | Template |
|------|------|----------|
| 09:30 | Text | morning-text.txt |
| 10:00 | Voice | voice.ogg (fallback chain) |
| 14:00 | Text | afternoon-text.txt |
| 14:30 | Voice | voice.ogg (same file) |

### Known Limitations
- Same voice file sent for morning AND afternoon (not differentiated)
- No multi-recipient support (deferred to Phase 4)
- No response tracking (deferred to Phase 3)
- `fillTemplate()` was removed — no placeholder support in messages

---

## Recent Changes

### 2026-06-18: Post-Audit Bug Fixes
- Fixed missing runtime deps in package.json (C-01)
- Fixed Node version check (lexicographic → integer) (C-03)
- Fixed TTS fallback path (copy before unlink) (H-01)
- Added process.exit(1) in uncaughtException handler (H-02)
- Added cron validation at startup (H-04)
- Fixed logger rotation (periodic, not per-write) (H-06)
- Removed dead fillTemplate code (H-03)
- Extended holidays.json to 2025-2030 (M-01)
- Added chatId type coercion for Telegram (M-02)
- Added voice fallback chain: ogg → mp3 → edge-tts (NEW)
- Added crash recovery in start.vbs (5 retries)

---

## Commands

```bash
# Setup
setup.bat                    # Install deps, create .env

# Run
node index.js                # Foreground (scan QR first time)
start.vbs                    # Background (silent, auto-restart)

# Voice
node generate-voice.js       # Generate voice.ogg via Edge-TTS
pip install edge-tts         # Install TTS engine

# Debug
notepad scheduler.log        # View logs
tasklist | findstr node      # Check if running
taskkill /F /IM chrome.exe /T  # Kill zombie Chromium

# Git
git add -A && git commit -m "msg"
git push origin main
```

---

## File Watch

Files I should re-read if they change:
- `index.js` — core logic
- `config.js` — configuration shape
- `package.json` — dependencies
- `.env.example` — available config vars

---

*This file auto-evolves. Update after significant architecture/convention changes.*
