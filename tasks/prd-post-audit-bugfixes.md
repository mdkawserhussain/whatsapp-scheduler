# PRD: Post-Audit Bug Fixes & Stability Hardening

**Author:** System Audit (auto-generated)
**Date:** 2026-06-18
**Status:** Draft
**Priority:** P0 — System cannot start without these fixes

---

## Problem Statement

A comprehensive 6-layer forensic audit of the WhatsApp Accounts Scheduler codebase identified **4 critical failures, 6 high-severity bugs, and 7 medium/low issues**. The most severe: the three runtime dependencies (`whatsapp-web.js`, `node-cron`, `qrcode-terminal`) are absent from `package.json` — anyone who clones the repo and runs `npm install` then `node index.js` gets an immediate `MODULE_NOT_FOUND` crash. The system has **zero functional capacity** in its current state.

Additional critical failures include a lexicographic Node version check that passes Node 9 but could reject valid versions, a `.env` file that ships with a placeholder phone number causing all sends to fail, and a TTS fallback path that deletes a file before attempting to copy it.

The goal is to fix all blocking issues, harden the system against the identified failure classes, and establish a verified baseline from which the scheduler can operate reliably.

## Solution

Fix all 17 identified issues in priority order (Critical → High → Medium → Low), with each fix being independently testable. The solution preserves the existing architecture and module boundaries — no new modules are introduced, no interfaces change, no behavioral semantics shift. This is a pure corrective maintenance pass.

## User Stories

### Critical Fixes (Must-Have — System Non-Functional Without)

1. As a developer cloning the repo, I want `npm install` to install all runtime dependencies, so that `node index.js` starts without `MODULE_NOT_FOUND` errors
2. As an operator, I want `package.json` to list `whatsapp-web.js`, `node-cron`, and `qrcode-terminal` as dependencies, so that the dependency graph is explicit and reproducible
3. As an operator, I want the Node.js version check to parse the major version as an integer, so that Node 9 doesn't falsely pass and Node 20 doesn't falsely fail
4. As an operator, I want `.env.example` to include a clear comment that `TARGET_PHONE` must be a real number, so that placeholder values are not accidentally deployed
5. As an operator, I want the startup validation to detect the placeholder phone pattern (`XXXXXXXXX`) and warn explicitly, so that misconfiguration is caught before the first cron fire

### High-Severity Fixes (System Unreliable Without)

6. As a developer, I want the TTS fallback path to copy the MP3 file before deleting it, so that voice generation doesn't crash when ffmpeg is missing
7. As an operator, I want the `uncaughtException` handler to call `process.exit(1)`, so that the process doesn't continue in a corrupted state
8. As a developer, I want `validate.js` to import `config.js` once at module load, so that it doesn't re-require the module 3 separate times (each triggering `process.exit` on failure)
9. As an operator, I want invalid cron expressions in `.env` to be caught at startup with a clear error, so that silent cron failures don't go unnoticed
10. As an operator, I want log rotation to check file size periodically (not on every write), so that `statSync` syscalls don't dominate I/O
11. As a developer, I want the unused `fillTemplate` export to be either wired into the send flow or removed, so that dead code doesn't cause confusion

### Medium-Severity Fixes (Degraded Operation)

12. As an operator, I want `holidays.json` to cover multiple years (2025-2030), so that holiday skipping works beyond 2026
13. As a developer, I want Telegram `chat_id` to be coerced to a number before sending, so that string IDs don't cause API errors
14. As an operator, I want logger write failures to be surfaced (not silently swallowed), so that disk issues are diagnosable
15. As an operator, I want the `.gitignore` to cover TTS temp files (`.tts-input.txt`, `.tts-output.mp3`), so that temporary artifacts aren't committed

### Low-Severity Fixes (Polish)

16. As an operator, I want `start.vbs` to include a restart-on-crash loop, so that the scheduler recovers from unexpected exits without manual intervention
17. As a developer, I want `package.json` to include `name`, `version`, `description`, `main`, `scripts`, and `engines` fields, so that the project metadata is complete and `npm start` works

## Implementation Decisions

### Module Changes (No New Modules)

| Module | Change Type | Description |
|--------|-------------|-------------|
| `package.json` | Rewrite | Add all 3 missing deps, add metadata, scripts, engines |
| `validate.js` | Rewrite | Fix Node version check, single `require('./config')`, remove redundant calls |
| `tts.js` | Patch | Reorder fallback path: copy before unlink |
| `index.js` | Patch | Add `process.exit(1)` in `uncaughtException` handler |
| `logger.js` | Patch | Periodic rotation check (every 100 writes), surface errors |
| `notifications.js` | Patch | Coerce `chatId` to number |
| `holidays.json` | Rewrite | Extend to 2025-2030 |
| `.gitignore` | Patch | Add `.tts-input.txt`, `.tts-output.mp3` |
| `.env.example` | Patch | Add placeholder warning comment |

### Architectural Decisions

- **No new dependencies introduced.** All fixes use existing Node.js stdlib or already-installed packages.
- **No interface changes.** All module exports remain identical. `config.js`, `templates.js`, `notifications.js`, `logger.js`, `validate.js`, `tts.js` maintain their current public APIs.
- **No behavioral changes to send logic.** The jitter, holiday check, template loading, and cron scheduling remain identical. Only the error handling and startup paths change.
- **`validate.js` imports `config.js` at module level** instead of per-check. This is safe because `config.js` is a pure data module with no side effects beyond `process.exit` on missing env vars (which is the desired behavior).
- **Log rotation threshold remains 5MB.** The change is only to check frequency (periodic vs. per-write).

### Cron Validation Decision

Invalid cron expressions will be caught by `node-cron`'s `cron.validate()` at startup. If invalid, the scheduler will log the specific field that failed and exit with code 1. This is preferred over silent skip because a mistyped cron in `.env` is a common operator error.

## Testing Decisions

### What Makes a Good Test

Tests should verify **external behavior** (does the module export the right shape? does the function return the expected result?) not implementation details (does it call `fs.statSync` exactly once?).

### Module Test Matrix

| Module | Test Type | Verification |
|--------|-----------|--------------|
| `config.js` | Integration | Loads `.env`, exports correct shape, validates required vars |
| `validate.js` | Unit | Returns `true` for valid config, `false` for placeholder phone |
| `logger.js` | Unit | Writes to file, respects log level, rotates at threshold |
| `notifications.js` | Unit | Sends HTTP request when enabled, no-ops when disabled |
| `tts.js` | Integration | Generates file when edge-tts available, graceful error when not |
| `templates.js` | Unit | Loads existing file, returns null for missing file |
| `index.js` | Integration | Starts without crash, registers cron, handles disconnect |

### Prior Art

No existing tests in the codebase. Tests will be added as a new `test/` directory using Node.js built-in `node:test` and `node:assert` (no additional test framework dependencies).

## Out of Scope

- **PM2 / Windows Service wrapper** — deferred to Phase 4 (architecture upgrades)
- **Health check HTTP endpoint** — deferred to Phase 4
- **Daily summary Telegram digest** — deferred to Phase 3 (intelligence features)
- **`holidays.json` auto-update script** — manual update is sufficient for 5-year coverage
- **Multi-recipient support** — explicitly deferred per original roadmap
- **Response tracking / analytics** — explicitly deferred per original roadmap
- **Voice file caching / optimization** — voice file is small (~50KB), caching adds complexity for no measurable gain
- **TypeScript migration** — out of scope for corrective maintenance

## Further Notes

### Execution Order

Fixes must be applied in this order due to dependencies:

1. `package.json` (C-01/C-04) — everything depends on this
2. `validate.js` (C-03, H-05) — startup gate
3. `tts.js` (H-01) — voice generation path
4. `index.js` (H-02) — process safety
5. `logger.js` (H-06, M-03, M-05) — observability
6. `notifications.js` (M-02) — notification reliability
7. `holidays.json` (M-01) — holiday coverage
8. `.gitignore` (L-02) — hygiene
9. `.env.example` (C-02) — documentation
10. `templates.js` (H-03) — dead code cleanup

### Verification

After all fixes are applied:
1. `npm install` succeeds and installs 4 packages
2. `node -e "require('./config')"` fails with clear error (placeholder phone)
3. `node -e "require('./validate')"` runs without crash
4. `node index.js` starts, shows QR code, and exits cleanly on Ctrl+C
5. `node -e "require('./logger')"` creates a Logger instance
6. `node -e "require('./notifications')"` creates a TelegramNotifier instance
7. `node -e "require('./tts')"` exports `{ generate, isAvailable }`
