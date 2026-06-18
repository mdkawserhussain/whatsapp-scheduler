## Relevant Files

- `index.js` - Main entry point — needs bug fixes, config loading, template loading, retry logic, graceful shutdown
- `.env` - New: environment variables (secrets, schedules, target)
- `.env.example` - New: template for .env (committed to git)
- `.gitignore` - New: git ignore rules
- `config.js` - New: centralized configuration loader from .env
- `templates.js` - New: message template loader with variable substitution
- `messages/morning_text.txt` - New: editable Bengali morning text message
- `messages/afternoon_text.txt` - New: editable Bengali afternoon text message
- `messages/morning_voice.txt` - New: optional voice-specific morning text
- `messages/afternoon_voice.txt` - New: optional voice-specific afternoon text
- `retry.js` - New: retry wrapper with exponential backoff
- `notifier.js` - New: Telegram bot notification module
- `audio.js` - New: audio format auto-conversion (MP3/WAV → OGG/Opus)
- `logger.js` - New: structured JSON logging with rotation
- `holidays.json` - New: Bangladesh holiday list for skip logic
- `start.vbs` - Modified: add watchdog retry loop
- `setup.bat` - Modified: add dotenv to package installs

### Notes

- All new modules use CommonJS (`module.exports`) to match existing codebase
- Keep `index.js` as single entry point — modules are imported
- If `.env` doesn't exist, fall back to current hardcoded values for backward compatibility
- Unit tests are out of scope for this phase

## Instructions for Completing Tasks

**IMPORTANT:** As you complete each task, you must check it off in this markdown file by changing `- [ ]` to `- [x]`. This helps track progress and ensures you don't skip any steps.

Example:
- `- [ ] 1.1 Read file` → `- [x] 1.1 Read file` (after completing)

Update the file after completing each sub-task, not just after completing an entire parent task.

## Tasks

- [x] 0.0 Create feature branch
  - [x] 0.1 Create and checkout a new branch for this feature (e.g., `git checkout -b feature/fire-and-forget-upgrade`)

- [x] 1.0 Fix Critical Bugs
  - [x] 1.1 Fix disconnection handler — add `client.destroy()` before `client.initialize()` in `client.on('disconnected')` at `index.js:105-108`
  - [x] 1.2 Fix duplicate cron registration — add `cronRegistered` flag so `registerCronJobs()` only runs once in `client.on('ready')` at `index.js:97-102`
  - [x] 1.3 Add ready-state guard — add `clientReady` boolean, set `true` on `ready` event, `false` on `disconnected`, check before every `sendMessage()` call
  - [x] 1.4 Add graceful shutdown — add `process.on('SIGINT')` and `process.on('SIGTERM')` handlers that call `client.destroy()` before exit
  - [x] 1.5 Add uncaught exception handlers — add `process.on('uncaughtException')` and `process.on('unhandledRejection')` with logging

- [ ] 2.0 Create Configuration System
  - [ ] 2.1 Create `.env.example` with all config variables (TARGET_PHONE, TIMEZONE, CRON schedules, VOICE_FILE, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, LOG_LEVEL, LOG_FILE)
  - [ ] 2.2 Create `.env` with actual values (copy from .env.example, fill in real target number)
  - [ ] 2.3 Install dotenv — `npm install dotenv`
  - [ ] 2.4 Create `config.js` — centralized config loader that reads from `process.env` with defaults, validates required vars (TARGET_PHONE), loads `holidays.json` if exists
  - [ ] 2.5 Update `index.js` — replace hardcoded CONFIG object with `require('./config')`
  - [ ] 2.6 Add startup validation — check target phone isn't placeholder, check voice file exists, validate cron expressions using `cron.validate()`

- [ ] 3.0 Create Message Template System
  - [ ] 3.1 Create `messages/` directory
  - [ ] 3.2 Create `messages/morning_text.txt` — copy current Bengali message from `index.js` MESSAGE constant
  - [ ] 3.3 Create `messages/afternoon_text.txt` — copy current Bengali message (same content for now)
  - [ ] 3.4 Create `messages/morning_voice.txt` — optional, can be same as morning_text.txt
  - [ ] 3.5 Create `messages/afternoon_voice.txt` — optional, can be same as afternoon_text.txt
  - [ ] 3.6 Create `templates.js` — `loadTemplate(filename, variables)` function, `getMessage(templateKey, variables)` with fallback logic, `resolvePlaceholders(text, recipient)` for `{name}`, `{date}`, `{day}`
  - [ ] 3.7 Update `index.js` — replace hardcoded MESSAGE constant with `getMessage('morningText')` calls
  - [ ] 3.8 Add dynamic date prefix — prepend `📅 ${today}` to messages for anti-spam

- [ ] 4.0 Add Error Resilience
  - [ ] 4.1 Create `retry.js` — `withRetry(fn, { maxAttempts, baseDelay, label })` with exponential backoff (2s, 4s, 8s)
  - [ ] 4.2 Create `notifier.js` — `sendTelegramAlert(message)` using https module, reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from config, silent no-op if not configured
  - [ ] 4.3 Add anti-ban jitter — `withJitter(fn, maxJitterMs)` wrapper that adds 0-120s random delay before send
  - [ ] 4.4 Wrap `sendText()` with retry + jitter
  - [ ] 4.5 Wrap `sendVoice()` with retry + jitter
  - [ ] 4.6 Add Telegram alert on QR code generation — session needs re-scan
  - [ ] 4.7 Add Telegram alert on auth failure — delete session and restart
  - [ ] 4.8 Add Telegram alert on 3+ consecutive disconnections
  - [ ] 4.9 Reset consecutive failure counter on successful auth

- [ ] 5.0 Add Audio Pipeline
  - [ ] 5.1 Create `audio.js` — `hasFfmpeg()` check, `convertToOggOpus(inputPath, outputPath)` using ffmpeg, `ensureOggFormat(audioPath)` auto-detect and convert
  - [ ] 5.2 Update `sendVoice()` to use `ensureOggFormat()` before sending
  - [ ] 5.3 Add pre-flight audio validation — warn on startup if voice file missing, log format info
  - [ ] 5.4 (Optional) Create `tts.js` — `textToVoice(text, outputPath)` using edge-tts (Microsoft Edge TTS, supports Bengali)

- [ ] 6.0 Add Structured Logging
  - [ ] 6.1 Create `logger.js` — `log.info()`, `log.warn()`, `log.error()`, `log.debug()` methods, JSON format with timestamp/level/message, console output with Bengali locale
  - [ ] 6.2 Add log rotation — rotate when file exceeds 5MB, keep one `.old.log` backup
  - [ ] 6.3 Add heartbeat file — write `heartbeat.txt` every 5 minutes with ISO timestamp
  - [ ] 6.4 Update `index.js` — replace all `console.log` and `log()` calls with structured logger

- [ ] 7.0 Add Holiday & Weekend Skip
  - [ ] 7.1 Create `holidays.json` — Bangladesh national holidays for 2026
  - [ ] 7.2 Add `shouldSkipToday()` function — check Friday (day 5) and holidays.json
  - [ ] 7.3 Add `safeSend()` wrapper — skip if `shouldSkipToday()` returns true, log reason
  - [ ] 7.4 Wrap all cron jobs with `safeSend()`

- [ ] 8.0 Upgrade Process Management
  - [ ] 8.1 Improve `start.vbs` — add watchdog loop (retry up to 50 times with 30s delay)
  - [ ] 8.2 Update `setup.bat` — add `dotenv` to package install list
  - [ ] 8.3 Create `ecosystem.config.js` — PM2 config with memory limit (500M), restart delay (10s), max restarts (10)
  - [ ] 8.4 Document PM2 setup commands in README section of `setup.bat` output

- [ ] 9.0 Add Security & Hygiene
  - [ ] 9.1 Create `.gitignore` — exclude `node_modules/`, `.wwebjs_auth/`, `.env`, `*.log`, `heartbeat.txt`, `.heartbeat`, `tmp_tts.mp3`, `Thumbs.db`, `Desktop.ini`, `.pm2/`
  - [ ] 9.2 Add session file protection command to README — `icacls .wwebjs_auth /inheritance:r /grant:r "%USERNAME%:F"`
  - [ ] 9.3 Create `backup-session.js` — copy `.wwebjs_auth/` to `backups/session_YYYY-MM-DD`

- [ ] 10.0 Verify & Test
  - [ ] 10.1 Run dry-run test — `node index.js --dry-run` (if implemented) or manual verification
  - [ ] 10.2 Verify config loading — rename `.env` to `.env.bak`, confirm error message on startup
  - [ ] 10.3 Verify template loading — edit `messages/morning_text.txt`, confirm change appears in next send
  - [ ] 10.4 Verify .gitignore — run `git status`, confirm `.env` and `.wwebjs_auth/` are not tracked
  - [ ] 10.5 Manual send test — temporarily change cron to fire in 1 minute, verify text and voice deliver correctly
  - [ ] 10.6 Verify PM2 — `pm2 start ecosystem.config.js`, `pm2 logs`, `pm2 stop hishab-bot`
