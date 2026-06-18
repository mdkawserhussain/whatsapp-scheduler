# WhatsApp Accounts Notice Scheduler — Improvements & Roadmap

> **Audience:** Technical (single developer/administrator)
> **Goal:** Fire-and-forget automation — set it up once, never touch it again
> **Last updated:** 2026-06-18

---

## Table of Contents

1. [Current State Audit](#1-current-state-audit)
2. [Fire-and-Forget Architecture](#2-fire-and-forget-architecture)
3. [Configuration & Customization System](#3-configuration--customization-system)
4. [Error Resilience & External Notifications](#4-error-resilience--external-notifications)
5. [Audio Pipeline Automation](#5-audio-pipeline-automation)
6. [Structured Logging & Monitoring](#6-structured-logging--monitoring)
7. [Process Management on Windows](#7-process-management-on-windows)
8. [Multi-Recipient & Template Engine](#8-multi-recipient--template-engine)
9. [Security & Project Hygiene](#9-security--project-hygiene)
10. [Testing Strategy](#10-testing-strategy)
11. [New Feature Roadmap](#11-new-feature-roadmap)
12. [Alternative Engines Deep Dive](#12-alternative-engines-deep-dive)
13. [Priority Roadmap & Implementation Checklist](#13-priority-roadmap--implementation-checklist)

---

## 1. Current State Audit

### What Works Well

| Strength | Details |
|----------|---------|
| **LocalAuth session persistence** | QR scan once, session saved to `.wwebjs_auth/`. No re-scan needed unless explicitly logged out. |
| **node-cron v4 with timezone** | Built-in `timezone: 'Asia/Dhaka'` — handles DST correctly, no manual UTC offset math. |
| **Basic reconnection** | `client.on('disconnected')` re-initializes after 10s. Covers most transient disconnections. |
| **File logging** | Every send attempt (success or failure) timestamped in `scheduler.log`. Useful for post-mortem. |
| **Silent background execution** | `start.vbs` runs Node.js invisibly — no terminal window cluttering the desktop. |
| **One-command setup** | `setup.bat` handles npm init + package installation in one double-click. |

### Technical Debt Map

| Issue | Severity | Impact |
|-------|----------|--------|
| **Hardcoded config in `index.js`** | High | Changing target number or schedule requires editing source code. Risk of committing phone numbers to version control. |
| **No `.env` support** | High | Secrets (phone number) mixed with code. |
| **No `.gitignore`** | High | If this ever goes to git: `node_modules/`, `.wwebjs_auth/`, `.env`, `*.log` all get committed. |
| **No crash recovery** | High | If Puppeteer process hangs or crashes, the 10s reconnect timer calls `client.initialize()` on a dead instance. Can cause recursive loops. |
| **Manual audio conversion** | Medium | User must know ffmpeg commands and run them manually. OGG/Opus requirement is non-obvious. |
| **No send failure retry** | Medium | If WhatsApp Web temporarily rejects a message (network blip), it's lost forever. No retry. |
| **No external failure notification** | Medium | Script runs silently. If WhatsApp session expires and needs QR re-scan, user won't know until they check `scheduler.log`. |
| **Single recipient only** | Low | Can't send to multiple people with different schedules. |
| **Hardcoded Bengali message** | Low | Editing the message requires opening `index.js`. |
| **No structured logging** | Low | Log lines are plain text. Hard to query/filter programmatically. |
| **No tests** | Low | No unit tests, no smoke tests. Changes require manual verification. |
| **No README** | Low | New developer (or future you) won't know how to set up or maintain. |

---

## 2. Fire-and-Forget Architecture

### Current Flow

```
User double-clicks start.vbs
  → Node.js starts silently
    → WhatsApp client initializes (Puppeteer)
      → QR code generated (first time only)
        → Cron jobs registered
          → Messages sent at scheduled times
            → Logs appended to scheduler.log
```

**Failure points:** No recovery if Puppeteer crashes. No notification if session expires. No watchdog.

### Desired Fire-and-Forget Flow

```
┌─────────────────────────────────────────────────────────┐
│                    BOOT / STARTUP                        │
│  PM2 auto-starts on Windows boot                        │
│  OR shortcut in shell:startup → start.vbs               │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               PROCESS MONITOR (PM2)                      │
│  • Auto-restarts on crash (exponential backoff)          │
│  • Logs to rotated files automatically                   │
│  • Memory limit kill + restart (>500MB)                  │
│  • `pm2 monit` for live dashboard                        │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│             WHATSAPP CLIENT LIFECYCLE                     │
│  • Auth check on startup                                 │
│  • If session invalid → Telegram alert with QR code      │
│  • On disconnect → destroy() → re-init after backoff     │
│  • On consecutive failures (3+) → Telegram alert         │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              CRON SCHEDULER                               │
│  • Load schedule from .env / config                      │
│  • Holiday skip check (optional)                         │
│  • Per-recipient template resolution                     │
│  • Send with retry (3 attempts, exponential backoff)     │
│  • Log result (structured JSON)                          │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              NOTIFICATION LAYER                           │
│  • On successful first send of day → silent              │
│  • On failure → Telegram/Discord webhook alert           │
│  • On session expiry → alert with re-scan instructions   │
│  • Daily summary (optional): "4/4 messages sent today"   │
└─────────────────────────────────────────────────────────┘
```

### Improved `start.vbs` with Watchdog

```vbs
' start.vbs — Fire-and-forget launcher with watchdog
' Runs node index.js silently. If Node crashes, waits 30s and retries.

Dim oShell, oFSO, sFolder, sLog
Set oShell = CreateObject("WScript.Shell")
Set oFSO   = CreateObject("Scripting.FileSystemObject")

sFolder = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sLog    = sFolder & "watchdog.log"
oShell.CurrentDirectory = sFolder

Dim maxRetries, retryCount
maxRetries = 50  ' ~25 minutes of retry attempts
retryCount = 0

Do While retryCount < maxRetries
    ' Run node index.js hidden (0 = no window, True = wait for it to finish/crash)
    oShell.Run "node index.js", 0, True

    retryCount = retryCount + 1

    ' Log the restart
    Dim f, ts
    Set f = oFSO.OpenTextFile(sLog, 8, True)  ' 8 = ForAppending
    f.WriteLine "[" & Now & "] Process exited. Retry " & retryCount & "/" & maxRetries
    f.Close

    ' Wait 30 seconds before retry (backoff would be better but VBScript is limited)
    WScript.Sleep 30000
Loop

Set oShell = Nothing
Set oFSO   = Nothing
```

**What this does:** If `node index.js` crashes for any reason, the VBS script waits 30 seconds and restarts it, up to 50 times. This covers Puppeteer crashes, memory leaks, and transient errors.

**Limitation:** VBScript can't do exponential backoff. For proper crash recovery with backoff, use PM2 (see Section 7).

---

## 3. Configuration & Customization System

### 3.1 Environment Variables with `dotenv`

Create `.env` in project root:

```env
# ── Target ──
TARGET_PHONE=8801XXXXXXXXX@c.us

# ── Timezone ──
TIMEZONE=Asia/Dhaka

# ── Cron Schedules (minute hour * * *) ──
MORNING_TEXT_CRON=30 9 * * *
MORNING_VOICE_CRON=0 10 * * *
AFTERNOON_TEXT_CRON=0 14 * * *
AFTERNOON_VOICE_CRON=30 14 * * *

# ── Audio ──
VOICE_FILE=voice.ogg

# ── Notifications (optional) ──
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# ── Logging ──
LOG_LEVEL=info
LOG_FILE=scheduler.log
```

Create `.env.example` (committed to git, no real values):

```env
TARGET_PHONE=8801XXXXXXXXX@c.us
TIMEZONE=Asia/Dhaka
MORNING_TEXT_CRON=30 9 * * *
MORNING_VOICE_CRON=0 10 * * *
AFTERNOON_TEXT_CRON=0 14 * * *
AFTERNOON_VOICE_CRON=30 14 * * *
VOICE_FILE=voice.ogg
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
LOG_LEVEL=info
LOG_FILE=scheduler.log
```

### 3.2 Configuration Loader Module

Create `config.js`:

```javascript
// config.js — Centralized configuration loader
'use strict';

require('dotenv').config();
const path = require('path');
const fs   = require('fs');

const required = ['TARGET_PHONE'];

// Validate required env vars
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing required env variable: ${key}`);
    console.error('   Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}

// Load holiday list if file exists
const holidaysPath = path.join(__dirname, 'holidays.json');
const holidays = fs.existsSync(holidaysPath)
  ? JSON.parse(fs.readFileSync(holidaysPath, 'utf-8'))
  : [];

module.exports = {
  target:     process.env.TARGET_PHONE,
  timezone:   process.env.TIMEZONE || 'Asia/Dhaka',
  voiceFile:  path.join(__dirname, process.env.VOICE_FILE || 'voice.ogg'),
  logLevel:   process.env.LOG_LEVEL || 'info',
  logFile:    path.join(__dirname, process.env.LOG_FILE || 'scheduler.log'),
  holidays,

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId:   process.env.TELEGRAM_CHAT_ID   || '',
  },

  schedules: {
    morningText:    process.env.MORNING_TEXT_CRON    || '30 9 * * *',
    morningVoice:   process.env.MORNING_VOICE_CRON   || '0 10 * * *',
    afternoonText:  process.env.AFTERNOON_TEXT_CRON   || '0 14 * * *',
    afternoonVoice: process.env.AFTERNOON_VOICE_CRON  || '30 14 * * *',
  },
};
```

### 3.3 Message Templates from Files

Create `messages/` folder:

```
messages/
  morning_text.txt
  morning_voice.txt    (optional: different text for voice)
  afternoon_text.txt
  afternoon_voice.txt
```

Example `messages/morning_text.txt`:

```
আসসালামু আলাইকুম স্যার।
প্রতিষ্ঠানের আর্থিক স্বচ্ছতার স্বার্থে চলতি মাস থেকে আমরা প্রতিদিনের খরচের হিসাব কঠোরভাবে রাখতে চাই।
এই মাস থেকে প্রতিষ্ঠানের সব খরচের হিসাব নিখুঁতভাবে রাখার জন্য আমাদের একটি নতুন প্রক্রিয়া মানতে হবে। এই লক্ষ্যে প্রতিদিন দুইবার আপনার কাছ থেকে নিম্নলিখিত তথ্য পাওয়া প্রয়োজন:
- গতকাল আপনার জানামতে কী খরচ হয়েছে?
- আজ আপনার জানামতে কী খরচ হচ্ছে?
- আগামীকাল আপনার জানামতে কী খরচ হতে পারে?

এই দৈনিক প্রাতিষ্ঠানিক হিসাব সঠিকভাবে রক্ষণাবেক্ষণের জন্য নিম্নোক্ত শর্তসমূহ মেনে চলা আবশ্যক:
১. প্রতিদিন তথ্য জানাতে হবে এবং তা শুধুমাত্র নির্ধারিত একজন ব্যক্তিকেই জানাতে হবে, একাধিক ব্যক্তির মধ্যে ভাগ করে নয়।
২. কোনো তথ্য মিস হলে, ভুলে গেলে বা পরিবর্তন/আপডেট করতে হলে তা অবশ্যই জানাতে হবে। অন্যথায় হিসাবে গরমিল দেখা দেবে।

যেসব খরচ সম্পর্কে অ্যাকাউন্টস বিভাগ অবগত, তার প্রতিটি পয়সার হিসাব আমরা নিশ্চিত করব ইনশাআল্লাহ। কিন্তু আপনার দিক থেকে কোনো খরচের তথ্য না পেলে মাস শেষে হিসাব মেলানো সম্ভব হবে না এবং এই অসামঞ্জস্যতার জন্য অ্যাকাউন্টস বিভাগকে দায়ী করা যাবে না।
ধন্যবাদান্তে,
অ্যাকাউন্টস
```

### 3.4 Template Loader with Variable Support

Add to `config.js` or create `templates.js`:

```javascript
// templates.js — Load message templates from files with variable substitution
'use strict';

const fs   = require('fs');
const path = require('path');

const MESSAGES_DIR = path.join(__dirname, 'messages');

function loadTemplate(filename, variables = {}) {
  const filePath = path.join(MESSAGES_DIR, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Template not found: ${filePath}`);
  }

  let content = fs.readFileSync(filePath, 'utf-8').trim();

  // Replace {variable} placeholders
  for (const [key, value] of Object.entries(variables)) {
    content = content.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }

  return content;
}

// Predefined template maps
const TEMPLATES = {
  morningText:    'morning_text.txt',
  morningVoice:   'morning_voice.txt',    // fallback: morning_text.txt
  afternoonText:  'afternoon_text.txt',
  afternoonVoice: 'afternoon_voice.txt',  // fallback: afternoon_text.txt
};

function getMessage(templateKey, variables = {}) {
  let filename = TEMPLATES[templateKey];

  // Fallback: if voice-specific template missing, use text version
  if (!fs.existsSync(path.join(MESSAGES_DIR, filename))) {
    filename = TEMPLATES[templateKey.replace('Voice', 'Text')
                                    .replace('Voice', 'Text')] || filename;
  }

  return loadTemplate(filename, variables);
}

module.exports = { loadTemplate, getMessage };
```

**Usage in `index.js`:**

```javascript
const { getMessage } = require('./templates');

// No more hardcoded message — loaded from file
const textMessage = getMessage('morningText', {
  // Add variables here when needed:
  // name: 'Rasel',
  // department: 'IT',
});
```

### 3.5 Holiday Skip Support

Create `holidays.json` in project root:

```json
{
  "2026-01-07": "Bangabandhu Memorial Day",
  "2026-02-21": "Language Martyrs' Day",
  "2026-03-26": "Independence Day",
  "2026-04-14": "Bengali New Year",
  "2026-05-01": "May Day",
  "2026-08-15": "National Mourning Day",
  "2026-12-16": "Victory Day",
  "2026-12-25": "Christmas Day"
}
```

Add to cron job registration:

```javascript
function isHoliday(date, holidays) {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  return holidays.includes(dateStr);
}

function safeSend(templateKey, sendFn) {
  return async function () {
    const now = new Date();
    if (isHoliday(now, CONFIG.holidays)) {
      log(`📅 Holiday detected — skipping ${templateKey}`);
      return;
    }
    await sendFn();
  };
}

// Usage:
cron.schedule(CONFIG.schedules.morningText, safeSend('morningText', sendText), opts);
```

---

## 4. Error Resilience & External Notifications

### 4.1 Retry with Exponential Backoff

```javascript
// retry.js — Retry wrapper with exponential backoff
'use strict';

async function withRetry(fn, { maxAttempts = 3, baseDelay = 2000, label = 'operation' } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLastAttempt = attempt === maxAttempts;
      const delay = baseDelay * Math.pow(2, attempt - 1); // 2s, 4s, 8s

      if (isLastAttempt) {
        throw err; // Re-throw on final attempt
      }

      log(`⚠️  ${label} failed (attempt ${attempt}/${maxAttempts}): ${err.message}`);
      log(`   Retrying in ${delay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

module.exports = { withRetry };
```

**Usage in send functions:**

```javascript
const { withRetry } = require('./retry');

async function sendText() {
  await withRetry(
    () => client.sendMessage(CONFIG.target, MESSAGE),
    { maxAttempts: 3, baseDelay: 2000, label: 'text send' }
  );
  log('📨 Text message sent successfully.');
}
```

### 4.2 Telegram Bot Notification

Create `notifier.js`:

```javascript
// notifier.js — Send alerts via Telegram bot
'use strict';

const https = require('https');
const CONFIG = require('./config');

async function sendTelegramAlert(message) {
  if (!CONFIG.telegram.botToken || !CONFIG.telegram.chatId) {
    return; // Telegram not configured — silent no-op
  }

  const url = `https://api.telegram.org/bot${CONFIG.telegram.botToken}/sendMessage`;

  const payload = JSON.stringify({
    chat_id:    CONFIG.telegram.chatId,
    text:       `🤖 *WhatsApp Scheduler*\n\n${message}`,
    parse_mode: 'Markdown',
  });

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(data);
        else reject(new Error(`Telegram API ${res.statusCode}: ${data}`));
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { sendTelegramAlert };
```

### 4.3 Integrate Alerts into Client Lifecycle

```javascript
// In index.js:
const { sendTelegramAlert } = require('./notifier');

let consecutiveFailures = 0;

client.on('qr', async (qr) => {
  log('⚠️  QR code generated — session needs re-scan.');
  await sendTelegramAlert(
    '⚠️ *Session expired!*\nQR code needs to be scanned.\n\nRun `node index.js` in a terminal to scan.'
  );
  qrcode.generate(qr, { small: true });
});

client.on('disconnected', async (reason) => {
  log(`⚠️  Disconnected (${reason}). Cleaning up...`);
  try { await client.destroy(); } catch (_) {}

  consecutiveFailures++;

  if (consecutiveFailures >= 3) {
    await sendTelegramAlert(
      `⚠️ *Repeated disconnections!*\nReason: ${reason}\nFailures: ${consecutiveFailures}\n\nManual intervention may be needed.`
    );
  }

  const delay = Math.min(10000 * Math.pow(2, consecutiveFailures - 1), 300000); // max 5 min
  log(`   Re-initializing in ${delay / 1000}s...`);
  setTimeout(() => client.initialize(), delay);
});

client.on('authenticated', () => {
  consecutiveFailures = 0; // Reset on successful auth
  log('✅ Authenticated.');
});
```

---

## 5. Audio Pipeline Automation

### 5.1 Auto-Convert Any Audio Format

Create `audio.js`:

```javascript
// audio.js — Automatic audio conversion to OGG/Opus for WhatsApp voice notes
'use strict';

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const INPUT_FORMATS = ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.wma'];
const TARGET_FORMAT = '.ogg';

/**
 * Check if ffmpeg is available on the system
 */
function hasFfmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert any audio file to OGG/Opus format for WhatsApp voice notes
 * @param {string} inputPath - Path to input audio file
 * @param {string} outputPath - Path for output .ogg file
 */
function convertToOggOpus(inputPath, outputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  if (!hasFfmpeg()) {
    throw new Error(
      'ffmpeg is not installed.\n' +
      'Install it from: https://ffmpeg.org/download.html\n' +
      'Or use: winget install ffmpeg'
    );
  }

  const cmd = [
    'ffmpeg', '-y',               // Overwrite output
    '-i', `"${inputPath}"`,       // Input
    '-c:a', 'libopus',            // Opus codec
    '-b:a', '32k',                // Bitrate (32kbps is fine for voice)
    '-ac', '1',                    // Mono
    '-ar', '48000',               // Sample rate (48kHz for Opus)
    '-application', 'voip',       // Voice-optimized mode
    `"${outputPath}"`,
  ].join(' ');

  try {
    execSync(cmd, { stdio: 'pipe' });
  } catch (err) {
    throw new Error(`ffmpeg conversion failed: ${err.stderr?.toString() || err.message}`);
  }

  // Validate output
  const stat = fs.statSync(outputPath);
  if (stat.size < 1000) {
    throw new Error(`Output file too small (${stat.size} bytes) — conversion likely failed`);
  }

  return outputPath;
}

/**
 * Ensure audio is in correct format, converting if necessary
 * @param {string} audioPath - Desired audio path (any format)
 * @returns {string} Path to .ogg file ready for WhatsApp
 */
function ensureOggFormat(audioPath) {
  const ext = path.extname(audioPath).toLowerCase();

  // Already OGG — check if it's valid
  if (ext === TARGET_FORMAT) {
    if (fs.existsSync(audioPath)) {
      return audioPath;
    }
    throw new Error(`OGG file not found: ${audioPath}`);
  }

  // Needs conversion
  if (!INPUT_FORMATS.includes(ext)) {
    throw new Error(`Unsupported audio format: ${ext}. Supported: ${INPUT_FORMATS.join(', ')}`);
  }

  const outputPath = audioPath.replace(/\.[^.]+$/, TARGET_FORMAT);
  log(`🔄 Converting ${ext} → OGG/Opus...`);
  convertToOggOpus(audioPath, outputPath);
  log(`✅ Conversion complete: ${outputPath}`);
  return outputPath;
}

module.exports = { ensureOggFormat, convertToOggOpus, hasFfmpeg };
```

### 5.2 Google Text-to-Speech (Optional)

For generating voice notes from text dynamically (no pre-recorded file needed):

```javascript
// tts.js — Generate voice notes from text using Google TTS
'use strict';

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const https = require('https');

/**
 * Generate OGG voice note from Bengali text using gTTS
 * Requires: pip install gTTS, and ffmpeg
 */
async function textToVoice(text, outputPath) {
  const tmpMp3 = path.join(__dirname, 'tmp_tts.mp3');

  try {
    // Step 1: Generate MP3 with gTTS (Google Text-to-Speech)
    const ttsCmd = `python -c "from gtts import gTTS; gTTS('${text.replace(/'/g, "\\'")}', lang='bn').save('${tmpMp3}')"`;
    execSync(ttsCmd, { stdio: 'pipe' });

    // Step 2: Convert MP3 → OGG/Opus for WhatsApp
    const ffmpegCmd = [
      'ffmpeg', '-y',
      '-i', `"${tmpMp3}"`,
      '-c:a', 'libopus', '-b:a', '48k',
      '-ac', '1', '-ar', '48000',
      `"${outputPath}"`,
    ].join(' ');

    execSync(ffmpegCmd, { stdio: 'pipe' });

    return outputPath;
  } finally {
    // Clean up temp file
    if (fs.existsSync(tmpMp3)) fs.unlinkSync(tmpMp3);
  }
}

module.exports = { textToVoice };
```

### 5.3 Pre-flight Audio Validation

Run before first cron job to catch issues early:

```javascript
function validateAudioSetup() {
  const voiceFile = CONFIG.voiceFile;

  if (!fs.existsSync(voiceFile)) {
    log(`⚠️  Voice file not found: ${voiceFile}`);
    log('   Voice notes will be skipped until you provide a file.');
    log('   Supported formats: OGG, MP3, WAV, M4A, FLAC');
    log('   The script will auto-convert non-OGG files using ffmpeg.');
    return false;
  }

  // Check if it's an OGG file (might need conversion)
  const ext = path.extname(voiceFile).toLowerCase();
  if (ext !== '.ogg') {
    log(`ℹ️  Voice file is ${ext} — will auto-convert to OGG/Opus on first send.`);
  }

  return true;
}
```

---

## 6. Structured Logging & Monitoring

### 6.1 Structured Logger Module

Create `logger.js`:

```javascript
// logger.js — Structured logging with levels and optional rotation
'use strict';

const fs   = require('fs');
const path = require('path');
const CONFIG = require('./config');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[CONFIG.logLevel] ?? LEVELS.info;

function formatEntry(level, message, meta = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  });
}

function writeLog(entry) {
  const line = entry + '\n';

  // Console output (human-readable)
  const parsed = JSON.parse(entry);
  const ts = new Date(parsed.timestamp).toLocaleString('bn-BD', { timeZone: CONFIG.timezone });
  const prefix = { debug: '🔍', info: 'ℹ️', warn: '⚠️', error: '❌' }[parsed.level] || '';
  console.log(`[${ts}] ${prefix} ${parsed.message}`);

  // File output (structured JSON)
  try { fs.appendFileSync(CONFIG.logFile, line); } catch (_) {}
}

const log = {
  debug: (msg, meta) => {
    if (currentLevel <= LEVELS.debug) writeLog(formatEntry('debug', msg, meta));
  },
  info: (msg, meta) => {
    if (currentLevel <= LEVELS.info) writeLog(formatEntry('info', msg, meta));
  },
  warn: (msg, meta) => {
    if (currentLevel <= LEVELS.warn) writeLog(formatEntry('warn', msg, meta));
  },
  error: (msg, meta) => {
    if (currentLevel <= LEVELS.error) writeLog(formatEntry('error', msg, meta));
  },
};

module.exports = log;
```

### 6.2 Log Rotation

Simple daily rotation without external dependencies:

```javascript
// logger.js — Add this function
function rotateLogIfneeded() {
  const logFile = CONFIG.logFile;
  if (!fs.existsSync(logFile)) return;

  const stat = fs.statSync(logFile);
  const ageMs = Date.now() - stat.mtimeMs;
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days

  if (ageMs > maxAgeMs) {
    const rotated = logFile.replace('.log', `_${new Date().toISOString().split('T')[0]}.log`);
    fs.renameSync(logFile, rotated);
    writeLog(formatEntry('info', `Log rotated: ${path.basename(rotated)}`));
  }
}
```

### 6.3 Heartbeat File

Write a "last successful send" timestamp for external monitoring:

```javascript
function writeHeartbeat(type) {
  const heartbeatPath = path.join(__dirname, '.heartbeat');
  const data = {
    lastSend:      new Date().toISOString(),
    lastSendType:  type,
    target:        CONFIG.target,
    consecutiveOK: (global._consecutiveOK || 0) + 1,
  };

  global._consecutiveOK = data.consecutiveOK;
  fs.writeFileSync(heartbeatPath, JSON.stringify(data, null, 2));
}
```

---

## 7. Process Management on Windows

### Comparison Table

| Feature | VBS (current) | PM2 | Windows Service | Docker |
|---------|--------------|-----|-----------------|--------|
| **Setup complexity** | Trivial | Easy | Medium | Hard |
| **Auto-restart on crash** | Manual watchdog | Built-in | Built-in | Built-in |
| **Log management** | Manual | Built-in rotation | Event Log | Docker logs |
| **Auto-start on boot** | shell:startup shortcut | pm2-startup | sc config | Docker auto-restart |
| **Memory monitoring** | None | `pm2 monit` | None | `docker stats` |
| **Process visibility** | Task Manager only | `pm2 list` | Services.msc | Docker Desktop |
| **Windows dependency** | Yes | Yes | Yes | Yes (Docker Desktop) |
| **Recommended for** | Quick & dirty | **Primary choice** | Enterprise | Cross-platform |

### Recommendation: PM2 (Primary)

**Setup:**

```bash
# Install globally
npm install -g pm2
npm install -g pm2-windows-startup

# Start the bot
pm2 start index.js --name "hishab-bot"

# Set up auto-start on Windows boot
pm2-startup          # Follow the prompts
pm2 save             # Save current process list
```

**Ecosystem config** (`ecosystem.config.js`):

```javascript
module.exports = {
  apps: [{
    name:              'hishab-bot',
    script:            'index.js',
    cwd:               __dirname,
    watch:             false,
    max_memory_restart: '500M',   // Kill & restart if RAM exceeds 500MB
    restart_delay:     10000,     // Wait 10s between restarts
    max_restarts:      10,        // Stop after 10 consecutive restarts
    env: {
      NODE_ENV: 'production',
    },
  }],
};
```

**Commands:**

```bash
pm2 start ecosystem.config.js    # Start with config
pm2 logs hishab-bot              # View live logs
pm2 monit                        # Live dashboard (CPU, RAM, restarts)
pm2 restart hishab-bot           # After code changes
pm2 stop hishab-bot              # Pause
pm2 delete hishab-bot            # Remove from PM2
pm2 save                         # Save current state (survives reboot)
```

### Alternative: Windows Task Scheduler

For users who don't want PM2:

```batch
@echo off
REM install-autostart.bat — Create Windows Task Scheduler entry
schtasks /create /tn "WhatsAppScheduler" /tr "\"%~dp0start.vbs\"" /sc ONLOGON /rl HIGHEST
echo Task "WhatsAppScheduler" created. Will start on Windows login.
pause
```

---

## 8. Multi-Recipient & Template Engine

### 8.1 Recipients Configuration

Create `recipients.json`:

```json
{
  "recipients": [
    {
      "name": "Sir",
      "phone": "8801712345678@c.us",
      "templates": {
        "morningText": "morning_text.txt",
        "afternoonText": "afternoon_text.txt"
      },
      "schedule": "default",
      "enabled": true
    },
    {
      "name": "Madam",
      "phone": "8801987654321@c.us",
      "templates": {
        "morningText": "morning_text_alt.txt",
        "afternoonText": "afternoon_text_alt.txt"
      },
      "schedule": "default",
      "enabled": true
    }
  ],
  "schedules": {
    "default": {
      "morningText":    "30 9 * * 1-5",
      "morningVoice":   "0 10 * * 1-5",
      "afternoonText":  "0 14 * * 1-5",
      "afternoonVoice": "30 14 * * 1-5"
    },
    "weekend": {
      "morningText":    "30 10 * * 0,6",
      "afternoonText":  "0 15 * * 0,6"
    }
  }
}
```

### 8.2 Multi-Recipient Loader

```javascript
// recipients.js — Load and manage multiple recipients
'use strict';

const fs   = require('fs');
const path = require('path');

const RECIPIENTS_PATH = path.join(__dirname, 'recipients.json');

function loadRecipients() {
  if (!fs.existsSync(RECIPIENTS_PATH)) {
    // Fallback to single-target from .env
    return [{
      name:      'Default',
      phone:     process.env.TARGET_PHONE,
      templates: {},  // Use default templates
      schedule:  'default',
      enabled:   true,
    }];
  }

  const data = JSON.parse(fs.readFileSync(RECIPIENTS_PATH, 'utf-8'));
  return data.recipients.filter(r => r.enabled);
}

function getSchedules(recipient, allSchedules) {
  const scheduleName = recipient.schedule || 'default';
  return allSchedules[scheduleName] || allSchedules.default;
}

module.exports = { loadRecipients, getSchedules };
```

### 8.3 Variable Placeholders in Templates

Templates support `{name}`, `{department}`, `{date}`, `{day}` placeholders:

```
আসসালামু আলাইকুম {name}।
আজ {date} ({day})।
...
```

Resolver:

```javascript
function resolvePlaceholders(text, recipient) {
  const now = new Date();
  const banglaDays = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];

  const vars = {
    name:       recipient.name || '',
    department: recipient.department || '',
    date:       now.toLocaleDateString('bn-BD', { timeZone: CONFIG.timezone }),
    day:        banglaDays[now.getDay()],
  };

  return text.replace(/\{(\w+)\}/g, (_, key) => vars[key] || `{${key}}`);
}
```

---

## 9. Security & Project Hygiene

### 9.1 `.gitignore`

```gitignore
# Dependencies
node_modules/

# WhatsApp session (contains login credentials)
.wwebjs_auth/

# Environment variables (contains phone numbers, tokens)
.env

# Logs
*.log
scheduler.log

# Generated audio
tmp_tts.mp3

# Heartbeat
.heartbeat

# OS files
Thumbs.db
Desktop.ini
.DS_Store

# PM2
.pm2/
```

### 9.2 Session Backup Strategy

The `.wwebjs_auth/` folder contains your WhatsApp session. Back it up:

```javascript
// backup-session.js — Run periodically or before major changes
'use strict';

const fs   = require('fs');
const path = require('path');

const SESSION_DIR = path.join(__dirname, '.wwebjs_auth');
const BACKUP_DIR  = path.join(__dirname, 'backups');

function backupSession() {
  if (!fs.existsSync(SESSION_DIR)) {
    console.log('No session to backup.');
    return;
  }

  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `session_${timestamp}`);

  fs.cpSync(SESSION_DIR, backupPath, { recursive: true });
  console.log(`✅ Session backed up to: ${backupPath}`);
}

backupSession();
```

### 9.3 Recommended Project Structure

```
hishab-whatsapp/
├── index.js                 # Main entry point
├── config.js                # Configuration loader
├── templates.js             # Message template loader
├── logger.js                # Structured logging
├── retry.js                 # Retry with backoff
├── notifier.js              # Telegram/Discord alerts
├── audio.js                 # Audio conversion
├── tts.js                   # Text-to-speech (optional)
├── recipients.js            # Multi-recipient loader
├── ecosystem.config.js      # PM2 config
├── .env                     # Secrets (not committed)
├── .env.example             # Template (committed)
├── .gitignore               # Git ignore rules
├── holidays.json            # Holiday skip list
├── messages/                # Editable message templates
│   ├── morning_text.txt
│   ├── morning_voice.txt
│   ├── afternoon_text.txt
│   └── afternoon_voice.txt
├── voice.ogg                # Voice note file
├── backups/                 # Session backups
├── setup.bat                # One-time setup
├── start.vbs                # Silent launcher
└── README.md                # Documentation
```

---

## 10. Testing Strategy

### 10.1 Smoke Test (Dry Run)

Add a `--dry-run` flag that logs what would be sent without actually sending:

```javascript
// In index.js
const isDryRun = process.argv.includes('--dry-run');

if (isDryRun) {
  log('🧪 DRY RUN MODE — no messages will be sent');
  log(`   Target: ${CONFIG.target}`);
  log(`   Schedule: ${JSON.stringify(CONFIG.schedules, null, 2)}`);
  log(`   Voice file: ${CONFIG.voiceFile} (exists: ${fs.existsSync(CONFIG.voiceFile)})`);

  // Test template loading
  try {
    const msg = getMessage('morningText');
    log(`   Morning text loaded (${msg.length} chars)`);
  } catch (err) {
    log(`   ❌ Template error: ${err.message}`);
  }

  process.exit(0);
}
```

### 10.2 Unit Tests

```javascript
// tests/config.test.js
const assert = require('assert');
const path   = require('path');

describe('Config', () => {
  it('should load .env without errors', () => {
    process.env.TARGET_PHONE = '8801000000000@c.us';
    const config = require('../config');
    assert.strictEqual(config.target, '8801000000000@c.us');
  });

  it('should use default timezone', () => {
    delete process.env.TIMEZONE;
    const config = require('../config');
    assert.strictEqual(config.timezone, 'Asia/Dhaka');
  });
});

describe('Templates', () => {
  it('should load template from messages folder', () => {
    const { loadTemplate } = require('../templates');
    // Create temp template for testing
    const fs = require('fs');
    const testFile = path.join(__dirname, '..', 'messages', 'test.txt');
    fs.writeFileSync(testFile, 'Hello {name}!');
    const result = loadTemplate('test.txt', { name: 'World' });
    assert.strictEqual(result, 'Hello World!');
    fs.unlinkSync(testFile);
  });
});

describe('Audio', () => {
  it('should detect ffmpeg availability', () => {
    const { hasFfmpeg } = require('../audio');
    const result = hasFfmpeg();
    assert.strictEqual(typeof result, 'boolean');
  });
});
```

Run with: `npm test` (add `"test": "node --test tests/"` to package.json)

### 10.3 Integration Test with Mock Client

```javascript
// tests/send.test.js
const assert = require('assert');

// Mock WhatsApp client for testing
const mockClient = {
  sendMessage: async (target, content, options) => {
    console.log(`[MOCK] Sending to ${target}: ${typeof content === 'string' ? content.substring(0, 50) + '...' : '[media]'}`);
    return { id: { _serialized: 'mock_msg_123' } };
  },
};

describe('Send Functions', () => {
  it('should send text message via mock', async () => {
    const result = await mockClient.sendMessage(
      '8801000000000@c.us',
      'Test message'
    );
    assert.ok(result.id._serialized);
  });
});
```

---

## 11. New Feature Roadmap

### Phase 3 Features (Future)

#### 11.1 Response Tracking (Read Receipts + Reply Detection)

**Architecture:**

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Send Message │────▶│  Store MsgID  │────▶│  Poll Replies │
│  (text/voice) │     │  in SQLite    │     │  every 5 min  │
└──────────────┘     └──────────────┘     └──────────────┘
                                                      │
                                                      ▼
                                             ┌──────────────┐
                                             │  Match Reply  │
                                             │  to Sent Msg  │
                                             └──────────────┘
                                                      │
                                                      ▼
                                             ┌──────────────┐
                                             │  Log Status   │
                                             │  + Notify     │
                                             └──────────────┘
```

**Implementation notes:**
- Store sent message IDs in SQLite (`better-sqlite3`)
- Use `client.on('message')` to listen for replies from target
- Match reply `quotedMsgId` to stored sent message ID
- Log: `{ sentAt, msgId, repliedAt, replyText, delay }`
- After 24h with no reply → send reminder notification

**Database schema:**

```sql
CREATE TABLE sent_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  msg_id      TEXT UNIQUE,
  recipient   TEXT,
  type        TEXT,        -- 'text' | 'voice'
  content     TEXT,
  sent_at     DATETIME,
  replied_at  DATETIME,
  reply_text  TEXT,
  status      TEXT DEFAULT 'pending'  -- 'pending' | 'replied' | 'reminder_sent'
);
```

#### 11.2 Web Dashboard (Express)

Lightweight Express server on port 3000:

```
GET  /                 → Dashboard UI (HTML)
GET  /api/status       → Bot status (running, last send, uptime)
GET  /api/logs         → Recent log entries (last 100)
GET  /api/sent         → Sent messages history
POST /api/send-now     → Trigger immediate send (manual override)
POST /api/update-holidays → Reload holidays.json
GET  /api/health       → Health check (for uptime monitoring)
```

#### 11.3 REST API Mode

Allow external systems to trigger sends:

```javascript
const express = require('express');
const app = express();

app.post('/api/send', async (req, res) => {
  const { recipient, template, variables } = req.body;
  // Validate, load template, send
  res.json({ success: true, msgId: result.id._serialized });
});

app.listen(3000);
```

#### 11.4 Other Future Features

| Feature | Description | Complexity |
|---------|-------------|------------|
| **Holiday calendar sync** | Auto-fetch Bangladesh govt holidays from an API | Low |
| **Weekly summary mode** | Instead of daily, send a weekly digest on Friday | Low |
| **Image attachments** | Send images alongside text (e.g., receipt photos) | Medium |
| **Voice note recording** | Record custom voice notes via browser/app | Medium |
| **Multiple message variants** | Rotate between 3-4 message templates to avoid monotony | Low |
| **Delivery confirmation** | Track when WhatsApp shows double-check (delivered) and blue ticks (read) | High |
| **Monthly report** | Auto-generate and send a monthly summary of all tracked expenses | High |
| **Database backend** | Replace JSON files with SQLite for better querying | Medium |

---

## 12. Alternative Engines Deep Dive

### Comparison Table

| Feature | whatsapp-web.js | Baileys | WAHA (Docker) | Official Cloud API |
|---------|----------------|---------|---------------|-------------------|
| **Architecture** | Puppeteer (headless Chrome) | Direct WebSocket | Docker container wrapping engines | Cloud REST API |
| **RAM Usage** | 200-400MB | 30-50MB | 300-500MB (Docker overhead) | 0MB (cloud) |
| **Ban Risk** | Medium (unofficial) | Medium (unofficial) | Medium (uses unofficial engines) | None (official) |
| **Setup Complexity** | Easy | Medium | Easy (Docker) | Hard (Meta approval) |
| **Voice Note Support** | Yes (OGG/Opus) | Yes (OGG/Opus) | Yes (via API) | Limited (templates only) |
| **Session Persistence** | LocalAuth (folder) | JSON file | Built-in | OAuth tokens |
| **Multi-Session** | Limited | Yes | Yes (built-in) | Yes |
| **QR Code Scan** | Yes | Yes | Yes (Web UI) | No (OAuth flow) |
| **Webhook Support** | No (polling) | No (polling) | Yes (REST + webhooks) | Yes (webhooks) |
| **Message Queue** | No | No | Yes (built-in) | Yes (official) |
| **Community** | Large, active | Large, active | Growing | Official Meta support |
| **Cost** | Free | Free | Free (self-hosted) | Free tier: 1000 convos/mo |
| **Windows Support** | Yes | Yes | Requires Docker Desktop | Yes (cloud) |
| **Maintenance Burden** | Medium (Puppeteer updates) | High (protobuf changes) | Low (Docker handles deps) | Low (Meta handles) |

### When to Consider Switching

| Scenario | Recommendation |
|----------|---------------|
| Low RAM machine (<4GB) | **Baileys** — 90% less memory |
| Want zero maintenance | **WAHA** — Docker handles everything |
| Need reliability for business | **Official Cloud API** — zero ban risk |
| Current setup works fine | **Stay with whatsapp-web.js** — it's working |
| Need multiple WhatsApp accounts | **WAHA** — built-in multi-session |
| Want REST API for external tools | **WAHA** or **Official API** |

### WAHA Quick Setup (If Switching Later)

```bash
# Install Docker Desktop for Windows, then:
docker run -d \
  --name waha \
  -p 3000:3000 \
  -v waha_sessions:/app/.sessions \
  devlikeapro/waha

# Send text via API:
curl -X POST http://localhost:3000/api/sendText \
  -H "Content-Type: application/json" \
  -d '{"chatId": "8801712345678@c.us", "text": "Hello!"}'
```

---

## 13. Priority Roadmap & Implementation Checklist

### Phase 1: Immediate (< 1 hour)

These changes are quick, safe, and dramatically improve the project:

- [ ] **Create `.env` file** — Move target phone and schedule out of source code
- [ ] **Create `.env.example`** — Template for version control
- [ ] **Create `.gitignore`** — Protect secrets, session, and logs
- [ ] **Create `config.js`** — Load config from environment variables
- [ ] **Create `messages/` folder** — Move Bengali text to editable `.txt` files
- [ ] **Create `templates.js`** — Load messages from files at runtime
- [ ] **Update `index.js`** — Use `config.js` and `templates.js` instead of hardcoded values
- [ ] **Run dry-run test** — `node index.js --dry-run` to verify without sending

**Result:** You can now change target number, schedule, and messages without touching code.

### Phase 2: Fire-and-Forget (1-2 days)

These make the system truly autonomous:

- [ ] **Install and configure PM2** — Process manager with auto-restart
- [ ] **Create `ecosystem.config.js`** — PM2 configuration file
- [ ] **Set up PM2 auto-start** — `pm2-windows-startup` + `pm2 save`
- [ ] **Add retry logic** — `retry.js` module with exponential backoff
- [ ] **Add Telegram notifications** — `notifier.js` for failure alerts
- [ ] **Improve `start.vbs`** — Add watchdog retry loop (backup for non-PM2 users)
- [ ] **Add audio auto-conversion** — `audio.js` with ffmpeg wrapper
- [ ] **Add structured logging** — `logger.js` with JSON format and log levels
- [ ] **Add log rotation** — Auto-rotate after 7 days
- [ ] **Add heartbeat file** — `.heartbeat` for external monitoring
- [ ] **Add pre-flight validation** — Check audio file, config, connectivity on startup
- [ ] **Add `holidays.json`** — Skip sends on national holidays

**Result:** System runs forever, recovers from crashes, alerts you on failures, converts audio automatically.

### Phase 3: Advanced (Future / Optional)

These add power features when you need them:

- [ ] **Multi-recipient support** — `recipients.json` with per-person configs
- [ ] **Variable placeholders** — `{name}`, `{date}`, `{day}` in templates
- [ ] **Web dashboard** — Express server with status, logs, manual send
- [ ] **REST API mode** — External trigger for sends
- [ ] **Response tracking** — SQLite database, reply detection, reminder system
- [ ] **Monthly reports** — Auto-generated expense summary
- [ ] **Image attachments** — Send photos alongside text
- [ ] **Multiple message variants** — Rotate templates to avoid monotony
- [ ] **Consider WAHA migration** — If scaling to multiple numbers or needing REST API

### Quick Reference: Files to Create/Modify

| File | Phase | Purpose |
|------|-------|---------|
| `.env` | 1 | Environment variables (secrets) |
| `.env.example` | 1 | Template for .env (committed) |
| `.gitignore` | 1 | Git ignore rules |
| `config.js` | 1 | Configuration loader |
| `templates.js` | 1 | Message template loader |
| `messages/*.txt` | 1 | Editable message files |
| `retry.js` | 2 | Retry with backoff |
| `notifier.js` | 2 | Telegram alerts |
| `audio.js` | 2 | Audio conversion |
| `logger.js` | 2 | Structured logging |
| `recipients.js` | 3 | Multi-recipient loader |
| `recipients.json` | 3 | Recipient configurations |
| `holidays.json` | 2 | Holiday skip list |
| `ecosystem.config.js` | 2 | PM2 configuration |
| `index.js` | 1+2 | Update to use new modules |

---

> **Bottom line:** Phase 1 gives you editability. Phase 2 gives you fire-and-forget. Phase 3 gives you superpowers. Start with Phase 1 today — it takes under an hour and eliminates the biggest pain points.
