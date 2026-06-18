# PRD: WhatsApp Accounts Notice Scheduler — Improvements & Fire-and-Forget Upgrade

## Introduction/Overview

The WhatsApp Accounts Notice Scheduler (`index.js`) is a Node.js application that sends automated daily Bengali text and voice messages to a fixed recipient for expense tracking. The current implementation works but has critical bugs (memory leaks, duplicate cron jobs), no crash recovery, hardcoded configuration, and requires manual intervention when things go wrong.

This PRD covers upgrading the scheduler to a **fire-and-forget** system that runs autonomously on Windows, recovers from crashes, alerts on failures, and allows editing messages without touching code.

## Goals

1. Fix 3 critical bugs causing memory leaks, duplicate sends, and unhandled errors
2. Move all configuration to `.env` files — no more editing source code
3. Move Bengali message templates to editable `.txt` files
4. Add crash recovery with automatic restart (PM2 or VBS watchdog)
5. Add external failure notifications via Telegram bot
6. Add audio auto-conversion (MP3/WAV → OGG/Opus)
7. Add structured logging with log rotation
8. Add anti-ban jitter (randomized send times)
9. Add graceful shutdown handlers
10. Create `.gitignore` to protect secrets and session files

## User Stories

1. **As a developer**, I want to change the target phone number by editing `.env` so I don't have to modify source code
2. **As a developer**, I want to edit the Bengali message in a `.txt` file so non-technical users can update it
3. **As an administrator**, I want the bot to restart automatically if it crashes so I never have to manually restart it
4. **As an administrator**, I want Telegram alerts when the bot needs attention (QR re-scan, repeated failures) so I know something is wrong without checking logs
5. **As a developer**, I want the bot to retry failed sends with exponential backoff so transient network issues don't lose messages
6. **As a developer**, I want audio files auto-converted to OGG/Opus so I can drop any audio format in the folder
7. **As a developer**, I want structured JSON logs with rotation so I can query logs programmatically and they don't fill the disk
8. **As an administrator**, I want the bot to skip sends on Fridays and national holidays so we don't send on non-working days
9. **As a developer**, I want graceful shutdown so Ctrl+C doesn't orphan Chromium processes

## Functional Requirements

### Critical Bug Fixes (Must-Have)
1. The system MUST call `client.destroy()` before `client.initialize()` in the disconnect handler to prevent zombie Chromium processes
2. The system MUST register cron jobs only once (not on every reconnect) to prevent duplicate sends
3. The system MUST check `clientReady` before attempting to send messages to prevent unhandled errors during reconnection

### Configuration System (Must-Have)
4. The system MUST load configuration from `.env` file using `dotenv`
5. The system MUST validate required configuration on startup and exit with clear error messages if missing
6. The system MUST support configurable cron schedules via environment variables
7. The system MUST support optional Telegram bot token and chat ID for notifications

### Message Templates (Must-Have)
8. The system MUST load Bengali message text from `.txt` files in `messages/` folder
9. The system MUST support `{name}`, `{date}`, `{day}` variable placeholders in templates
10. The system MUST prepend dynamic date to messages for anti-spam purposes

### Error Resilience (Must-Have)
11. The system MUST retry failed sends up to 3 times with exponential backoff (2s, 4s, 8s)
12. The system MUST add random jitter (0-120s) before sends to appear human-like
13. The system MUST send Telegram alerts on: session expiry (QR needed), auth failure, 3+ consecutive disconnections
14. The system MUST implement graceful shutdown (SIGINT/SIGTERM handlers that call `client.destroy()`)

### Audio Pipeline (Should-Have)
15. The system MUST auto-convert MP3/WAV/M4A/FLAC audio to OGG/Opus using ffmpeg
16. The system MUST validate audio file exists before attempting to send voice notes
17. The system MUST support Microsoft Edge TTS for dynamic voice generation from text

### Logging & Monitoring (Should-Have)
18. The system MUST write structured JSON logs with timestamps, levels, and metadata
19. The system MUST rotate logs when they exceed 5MB
20. The system MUST write a heartbeat file every 5 minutes for external monitoring

### Process Management (Should-Have)
21. The system MUST support PM2 for auto-restart on crash with memory limits
22. The system MUST support VBS watchdog loop as zero-install alternative
23. The system MUST auto-start on Windows boot (via PM2 or Task Scheduler)

### Security (Should-Have)
24. The system MUST have `.gitignore` excluding `.wwebjs_auth/`, `.env`, `node_modules/`, `*.log`
25. The system MUST restrict Windows file permissions on `.wwebjs_auth/` folder

### Holiday & Weekend Skip (Nice-to-Have)
26. The system MUST skip sends on Fridays (Bangladesh weekend)
27. The system MUST skip sends on dates listed in `holidays.json`

## Non-Goals (Out of Scope)

1. **Multi-recipient support** — Deferred to Phase 4 (future)
2. **Web dashboard** — Deferred to Phase 3 (future)
3. **REST API mode** — Deferred to Phase 3 (future)
4. **Response tracking with SQLite** — Deferred to Phase 3 (future)
5. **Migration to Baileys or WAHA** — Deferred to Phase 4 (future)
6. **WhatsApp Business Official API** — Not applicable (requires Meta approval)
7. **Unit test framework setup** — Out of scope for this phase
8. **CI/CD pipeline** — Out of scope for this phase

## Design Considerations

- All new modules (`config.js`, `templates.js`, `retry.js`, `notifier.js`, `audio.js`, `logger.js`) should be CommonJS (`module.exports`) to match existing codebase
- Keep backward compatibility: if `.env` doesn't exist, fall back to current hardcoded values
- Keep `index.js` as the single entry point — modules are imported, not separate processes
- `start.vbs` should be improved with watchdog loop but remain optional (PM2 is preferred)

## Technical Considerations

- **Runtime:** Node.js ≥ 18 (required by whatsapp-web.js@1.34.7)
- **Dependencies to add:** `dotenv` (config loading)
- **Optional dependencies:** `fluent-ffmpeg` (audio conversion), `edge-tts` (TTS via Python)
- **External tools:** ffmpeg (for audio conversion), Python + edge-tts (for TTS)
- **WhatsApp session:** `.wwebjs_auth/` contains login credentials — must be protected
- **Cron library:** node-cron@4.3.0 (already installed, supports timezone option)

## Success Metrics

1. **Zero manual restarts** — Bot runs for 30+ days without human intervention
2. **Zero duplicate sends** — No instance of receiving the same message twice
3. **Zero memory leaks** — RAM usage stays stable (no Chromium process accumulation)
4. **100% send success rate** — All scheduled messages delivered (retry handles transient failures)
5. **< 5 minute alert time** — Telegram notification received within 5 minutes of failure
6. **Zero code edits for config changes** — Target number, schedule, and messages editable via `.env` and `.txt` files

## Open Questions

1. Should the Telegram bot be created automatically, or is the user expected to create it manually via BotFather?
2. Is ffmpeg already installed on the target Windows machine, or should the setup script install it?
3. Should the heartbeat file be JSON or plain text timestamp?
4. Should `holidays.json` be auto-fetched from an API, or manually maintained?
