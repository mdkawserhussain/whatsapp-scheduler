# Task List: Post-Audit Bug Fixes & Stability Hardening

**PRD:** `tasks/prd-post-audit-bugfixes.md`
**Branch:** `feature/fire-and-forget-upgrade`
**Estimated Effort:** 2-3 hours total

---

## Phase 1: Critical Fixes (System Non-Functional Without)

- [ ] 1.0 Fix package.json — add missing runtime dependencies
  - [ ] 1.1 Add `whatsapp-web.js@^1.34.7` to dependencies
  - [ ] 1.2 Add `node-cron@^4.3.0` to dependencies
  - [ ] 1.3 Add `qrcode-terminal@^0.12.0` to dependencies
  - [ ] 1.4 Add project metadata: name, version, description, main, scripts, engines
  - [ ] 1.5 Run `npm install` and verify 4 packages in `node_modules`

- [ ] 2.0 Fix validate.js — Node version check + redundant requires
  - [ ] 2.1 Replace lexicographic `process.version >= 'v18'` with `parseInt(process.version.slice(1)) >= 18`
  - [ ] 2.2 Move `require('./config')` to single top-level import
  - [ ] 2.3 Remove redundant `require('./config')` calls in individual checks
  - [ ] 2.4 Add cron expression validation using `cron.validate()`

- [ ] 3.0 Fix .env.example — placeholder warning
  - [ ] 3.1 Add comment above `TARGET_PHONE`: `# IMPORTANT: Replace XXXXXXXXX with real number`
  - [ ] 3.2 Add comment: `# Format: country code + number + @c.us (e.g. 8801712345678@c.us)`

## Phase 2: High-Severity Fixes (System Unreliable Without)

- [ ] 4.0 Fix tts.js — fallback path file deletion order
  - [ ] 4.1 Move `fs.unlinkSync(mp3File)` after the `if (convErr)` fallback block
  - [ ] 4.2 Verify: when ffmpeg is missing, MP3 is copied to `voice.ogg` before cleanup

- [ ] 5.0 Fix index.js — uncaughtException handler
  - [ ] 5.1 Add `process.exit(1)` after the log statement in `uncaughtException` handler
  - [ ] 5.2 Verify: `unhandledRejection` handler also exits (or logs and continues — confirm intent)

- [ ] 6.0 Fix logger.js — rotation frequency + error surfacing
  - [ ] 6.1 Add write counter, check rotation every 100 writes instead of every write
  - [ ] 6.2 Replace silent `catch (_) {}` with `console.error` fallback in `_write`
  - [ ] 6.3 Verify: rotation still triggers at 5MB threshold

- [ ] 7.0 Fix templates.js — remove or wire up fillTemplate
  - [ ] 7.1 Decision: remove `fillTemplate` export (dead code) OR wire it into sendText/sendVoice
  - [ ] 7.2 If removing: delete function and remove from `module.exports`
  - [ ] 7.3 If wiring: add date placeholder resolution in sendText/sendVoice before sendMessage

## Phase 3: Medium-Severity Fixes (Degraded Operation)

- [ ] 8.0 Fix holidays.json — extend to 2025-2030
  - [ ] 8.1 Add 2025 Bangladesh national holidays
  - [ ] 8.2 Add 2027-2030 estimated holidays (same dates recur annually)
  - [ ] 8.3 Verify: `isHoliday()` returns correct results for past/future dates

- [ ] 9.0 Fix notifications.js — chatId type coercion
  - [ ] 9.1 Change `chat_id: this.chatId` to `chat_id: Number(this.chatId) || this.chatId`
  - [ ] 9.2 Verify: string IDs from `.env` are coerced to numbers for Telegram API

- [ ] 10.0 Fix .gitignore — cover TTS temp files
  - [ ] 10.1 Add `.tts-input.txt` and `.tts-output.mp3` to `.gitignore`

## Phase 4: Low-Severity Fixes (Polish)

- [ ] 11.0 Fix start.vbs — crash recovery loop
  - [ ] 11.1 Wrap `oShell.Run` in a retry loop with 30s delay on exit
  - [ ] 11.2 Add max retry count (5) before giving up

- [ ] 12.0 Run npm install to regenerate package-lock.json
  - [ ] 12.1 Delete `node_modules` and `package-lock.json`
  - [ ] 12.2 Run `npm install` fresh
  - [ ] 12.3 Verify `package-lock.json` includes all 4 dependencies

## Verification Checklist

- [ ] V1: `npm install` succeeds and installs 4 packages
- [ ] V2: `node -e "require('./config')"` exits with error (placeholder phone)
- [ ] V3: `node -e "require('./validate')"` exports function without crash
- [ ] V4: `node -e "require('./logger')"` exports Logger class
- [ ] V5: `node -e "require('./notifications')"` exports TelegramNotifier class
- [ ] V6: `node -e "require('./tts')"` exports `{ generate, isAvailable }`
- [ ] V7: `node -e "require('./templates')"` exports `{ loadMessage, fillTemplate, MESSAGES_DIR }`
- [ ] V8: `node index.js` starts without MODULE_NOT_FOUND errors
- [ ] V9: All `.js` files pass `node --check` (syntax validation)
