# WhatsApp Accounts Notice Scheduler — Final Improvements & Roadmap

> **Audience:** Technical (single developer/administrator)
> **Goal:** Fire-and-forget automation — set it up once, never touch it again
> **Sources:** Merged from `improvements.md` (OpenCode analysis) + `improvements-claude.md` (Claude analysis)
> **Last updated:** 2026-06-18

---

## Table of Contents

1. [Current State Audit](#1-current-state-audit)
2. [Critical Bugs to Fix Immediately](#2-critical-bugs-to-fix-immediately)
3. [Fire-and-Forget Architecture](#3-fire-and-forget-architecture)
4. [Configuration & Customization System](#4-configuration--customization-system)
5. [Error Resilience & External Notifications](#5-error-resilience--external-notifications)
6. [Audio Pipeline Automation](#6-audio-pipeline-automation)
7. [Structured Logging & Monitoring](#7-structured-logging--monitoring)
8. [Process Management on Windows](#8-process-management-on-windows)
9. [Multi-Recipient & Template Engine](#9-multi-recipient--template-engine)
10. [Security & Anti-Ban Practices](#10-security--anti-ban-practices)
11. [New Features Worth Adding](#11-new-features-worth-adding)
12. [Alternative Engines Deep Dive](#12-alternative-engines-deep-dive)
13. [Priority Roadmap & Implementation Checklist](#13-priority-roadmap--implementation-checklist)

---

## 1. Current State Audit

### Architecture Diagram

```
                         ┌─────────────────────────────┐
  Windows Boot           │        start.vbs             │
  (manual shortcut)      │  Launches node invisibly     │
                         └─────────────┬───────────────┘
                                       │
                                       ▼
┌─────────────┐  QR scan  ┌───────────────────────────────────┐
│  WhatsApp   │◄──────────│           index.js                 │
│  Phone App  │ (one-time) │                                   │
└─────────────┘            │  whatsapp-web.js@1.34.7           │
                           │    └── Puppeteer/Chromium (~300MB)│
                           │                                   │
                           │  node-cron@4.3.0                  │
                           │    ├── 09:30  text                │
                           │    ├── 10:00  voice.ogg           │
                           │    ├── 14:00  text                │
                           │    └── 14:30  voice.ogg           │
                           │                                   │
                           │  scheduler.log (append-only)      │
                           └───────────────────────────────────┘
```

### What Works Well

| ✅ Strength | Detail |
|---|---|
| **Config object** | All tunables (`target`, `timezone`, `schedules`) grouped in one `CONFIG` block |
| **Session persistence** | `LocalAuth` saves QR session to `.wwebjs_auth/` — scan once, never again |
| **Timezone-aware cron** | `node-cron@4.3.0` has native `timezone` option — no manual UTC offset math |
| **Dual logging** | Every event writes to both `console` and `scheduler.log` with Bengali timestamps |
| **Voice file guard** | `fs.existsSync()` check before attempting to send `voice.ogg` |
| **Silent launcher** | `start.vbs` runs Node with zero visible windows |
| **One-command setup** | `setup.bat` handles npm init + package installation in one double-click |

### Technical Debt Map

| ❌ Issue | Severity | Why it matters |
|---|---|---|
| **Reconnection creates zombie Chromium processes** | **Critical** | `client.initialize()` called without `client.destroy()` first — stacks memory |
| **Cron jobs re-register on every reconnect** | **Critical** | Causes duplicate sends (2x, 3x, 4x...) after each disconnect/reconnect cycle |
| **No send-readiness guard** | **High** | If client is mid-reconnect when cron fires, the send throws an unhandled error |
| **No retry on send failure** | **High** | A single network blip = message permanently lost |
| **No external notification on failure** | **High** | Script runs silently — if QR re-scan is needed, nobody knows |
| **Hardcoded config in `index.js`** | **High** | Changing target number or schedule requires editing source code |
| **No `.env` support** | **High** | Secrets (phone number) mixed with code |
| **No `.gitignore`** | **High** | `.wwebjs_auth/`, `node_modules/`, logs could leak to git |
| **No graceful shutdown** | **Medium** | Ctrl+C orphans the Chromium process |
| **`scheduler.log` grows forever** | **Medium** | No rotation — disk fills up over months |
| **Hardcoded Bengali message** | **Low** | Editing the message requires opening `index.js` |
| **No structured logging** | **Low** | Log lines are plain text. Hard to query/filter programmatically |
| **No tests** | **Low** | No unit tests, no smoke tests |
| **No README** | **Low** | New developer (or future you) won't know how to set up or maintain |

---

## 2. Critical Bugs to Fix Immediately

### Bug 1: Disconnection handler causes memory leak

**Location:** `index.js:105-108`

```javascript
// ❌ CURRENT — dangerous
client.on('disconnected', (reason) => {
  log(`⚠️  Disconnected (${reason}). Reconnecting in 10 s…`);
  setTimeout(() => client.initialize(), 10_000);  // ← no destroy() first!
});
```

**What goes wrong:** Each `client.initialize()` spawns a new headless Chromium process. Without `client.destroy()`, old processes stay alive. After 3 disconnects you have 4 Chromium instances consuming 1.2 GB RAM. After 10 disconnects you're at 3+ GB.

**Fix:**
```javascript
// ✅ FIXED — destroy before re-init
client.on('disconnected', async (reason) => {
  log(`⚠️  Disconnected (${reason}). Cleaning up…`);
  try {
    await client.destroy();
  } catch (e) {
    log(`   Destroy error (safe to ignore): ${e.message}`);
  }
  log('   Re-initializing in 15s…');
  setTimeout(() => client.initialize(), 15_000);
});
```

---

### Bug 2: Duplicate cron jobs on reconnect

**Location:** `index.js:97-102`

```javascript
// ❌ CURRENT — cron jobs multiply
client.on('ready', () => {
  log('✅ WhatsApp client ready.');
  registerCronJobs();  // ← called AGAIN after every reconnect
});
```

**What goes wrong:** If the client disconnects and reconnects once, `registerCronJobs()` runs a second time. Now you have 8 cron tasks instead of 4. Each subsequent reconnect adds 4 more. Messages pile up: 2 texts at 9:30 the first time, 3 texts after the second disconnect, etc.

**Fix:**
```javascript
// ✅ FIXED — register cron once
let cronRegistered = false;

client.on('ready', () => {
  log('✅ WhatsApp client ready.');
  log(`   Target: ${CONFIG.target}`);
  if (!cronRegistered) {
    registerCronJobs();
    cronRegistered = true;
  } else {
    log('   Cron jobs already active (not re-registering).');
  }
});
```

---

### Bug 3: No ready-state guard on sends

**What goes wrong:** Cron fires at 9:30 but the client is mid-reconnect (not `ready`). The `sendMessage()` call throws because the underlying Puppeteer page isn't available.

**Fix:**
```javascript
let clientReady = false;

client.on('ready', () => { clientReady = true; });
client.on('disconnected', () => { clientReady = false; });

async function sendText() {
  if (!clientReady) {
    log('⏳ Client not ready — skipping this send.');
    return;
  }
  try {
    await client.sendMessage(CONFIG.target, MESSAGE);
    log('📨 Text message sent successfully.');
  } catch (err) {
    log(`❌ Text send failed: ${err.message}`);
  }
}
```

---

## 3. Fire-and-Forget Architecture

### Desired Flow

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
│  • Register once (not on reconnect)                      │
│  • Holiday skip check                                    │
│  • Anti-ban jitter (±2 min random delay)                 │
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

    ' Wait 30 seconds before retry
    WScript.Sleep 30000
Loop

Set oShell = Nothing
Set oFSO   = Nothing
```

**What this does:** If `node index.js` crashes for any reason, the VBS script waits 30 seconds and restarts it, up to 50 times. This covers Puppeteer crashes, memory leaks, and transient errors.

**Limitation:** VBScript can't do exponential backoff. For proper crash recovery with backoff, use PM2 (see Section 8).

---

## 4. Configuration & Customization System

### 4.1 Environment Variables with `dotenv`

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

### 4.2 Configuration Loader Module

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

### 4.3 Message Templates from Files

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

### 4.4 Template Loader with Variable Support

Create `templates.js`:

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

const TEMPLATES = {
  morningText:    'morning_text.txt',
  morningVoice:   'morning_voice.txt',
  afternoonText:  'afternoon_text.txt',
  afternoonVoice: 'afternoon_voice.txt',
};

function getMessage(templateKey, variables = {}) {
  let filename = TEMPLATES[templateKey];

  // Fallback: if voice-specific template missing, use text version
  if (!fs.existsSync(path.join(MESSAGES_DIR, filename))) {
    filename = TEMPLATES[templateKey.replace('Voice', 'Text')] || filename;
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

### 4.5 Dynamic Date in Message (Anti-Spam)

Makes each message unique — helps avoid WhatsApp's spam detection:

```javascript
function buildMessage(templateKey, variables = {}) {
  const today = new Date().toLocaleDateString('bn-BD', {
    timeZone: CONFIG.timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const baseMsg = getMessage(templateKey, variables);
  return `📅 ${today}\n\n${baseMsg}`;
}
```

### 4.6 Holiday Skip Support

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

function shouldSkipToday() {
  const now = new Date();
  const day = now.getDay();
  const dateStr = now.toISOString().slice(0, 10);

  if (day === 5) return 'Friday (weekend)';
  if (CONFIG.holidays.includes(dateStr)) return `Holiday (${dateStr})`;
  return false;
}

function safeSend(templateKey, sendFn) {
  return async function () {
    const skipReason = shouldSkipToday();
    if (skipReason) {
      log(`📅 Skipping: ${skipReason}`);
      return;
    }
    await sendFn();
  };
}

// Usage:
cron.schedule(CONFIG.schedules.morningText, safeSend('morningText', sendText), opts);
```

### 4.7 Startup Validation

Catch misconfiguration before the client even starts:

```javascript
const cron = require('node-cron');

function validateConfig() {
  const errors = [];

  if (!CONFIG.target || CONFIG.target.includes('XXXX'))
    errors.push('TARGET_PHONE not set — edit .env file');

  if (!fs.existsSync(CONFIG.voiceFile))
    errors.push(`Voice file missing: ${CONFIG.voiceFile}`);

  for (const [name, expr] of Object.entries(CONFIG.schedules)) {
    if (!cron.validate(expr))
      errors.push(`Invalid cron for ${name}: "${expr}"`);
  }

  if (errors.length) {
    errors.forEach(e => log(`❌ ${e}`));
    process.exit(1);
  }
  log('✅ Configuration validated.');
}
```

---

## 5. Error Resilience & External Notifications

### 5.1 Retry with Exponential Backoff

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
  if (!clientReady) {
    log('⏳ Client not ready — skipping.');
    return;
  }
  await withRetry(
    () => client.sendMessage(CONFIG.target, buildMessage('morningText')),
    { maxAttempts: 3, baseDelay: 2000, label: 'text send' }
  );
  log('📨 Text message sent successfully.');
}
```

### 5.2 Anti-Ban Jitter

Sending messages at exactly the same second every day looks robotic. Add human-like randomness:

```javascript
function withJitter(fn, maxJitterMs = 120_000) {
  return async () => {
    const jitter = Math.floor(Math.random() * maxJitterMs);
    log(`⏱️  Jitter: waiting ${(jitter / 1000).toFixed(0)}s before sending…`);
    await new Promise(r => setTimeout(r, jitter));
    await fn();
  };
}

// In registerCronJobs()
cron.schedule(CONFIG.schedules.morningText, withJitter(sendText), opts);
```

### 5.3 Telegram Bot Notification

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

  return new Promise((resolve) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', () => {}); // fail silently
    req.write(payload);
    req.end();
  });
}

module.exports = { sendTelegramAlert };
```

### 5.4 Integrate Alerts into Client Lifecycle

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

client.on('auth_failure', async (msg) => {
  log(`❌ Authentication failed: ${msg}`);
  await sendTelegramAlert(`❌ *Auth failed:* ${msg}\nDelete .wwebjs_auth/ and restart.`);
  process.exit(1);
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

### 5.5 Graceful Shutdown

Prevent orphaned Chromium processes when the script stops:

```javascript
async function shutdown(signal) {
  log(`🛑 ${signal} — shutting down…`);
  try { await client.destroy(); } catch (_) {}
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  log(`💥 Uncaught exception: ${err.message}\n${err.stack}`);
});
process.on('unhandledRejection', (reason) => {
  log(`💥 Unhandled rejection: ${reason}`);
});
```

---

## 6. Audio Pipeline Automation

### 6.1 Auto-Convert Any Audio Format

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
    'ffmpeg', '-y',
    '-i', `"${inputPath}"`,
    '-c:a', 'libopus',
    '-b:a', '32k',
    '-ac', '1',
    '-ar', '48000',
    `-application`, 'voip',
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
 */
function ensureOggFormat(audioPath) {
  const ext = path.extname(audioPath).toLowerCase();

  if (ext === TARGET_FORMAT) {
    if (fs.existsSync(audioPath)) {
      return audioPath;
    }
    throw new Error(`OGG file not found: ${audioPath}`);
  }

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

### 6.2 Microsoft Edge TTS (Recommended — Free, No API Key)

Generate voice notes from text dynamically using Microsoft Edge TTS (supports Bengali):

```bash
# One-time install
pip install edge-tts
```

```javascript
// tts.js — Generate voice notes from text using Microsoft Edge TTS
'use strict';

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

/**
 * Generate OGG voice note from Bengali text using Edge TTS
 * Voices: bn-BD-NabanitaNeural (female), bn-BD-PradeepNeural (male)
 */
function textToVoice(text, outputPath, voice = 'bn-BD-NabanitaNeural') {
  const tmpMp3 = outputPath.replace('.ogg', '_tmp.mp3');
  const escaped = text.replace(/"/g, '\\"');

  try {
    // Step 1: Generate MP3 with Edge TTS
    execSync(
      `edge-tts --voice ${voice} --text "${escaped}" --write-media "${tmpMp3}"`,
      { stdio: 'pipe' }
    );

    // Step 2: Convert MP3 → OGG/Opus for WhatsApp
    const { convertToOggOpus } = require('./audio');
    convertToOggOpus(tmpMp3, outputPath);

    return outputPath;
  } finally {
    // Clean up temp file
    if (fs.existsSync(tmpMp3)) fs.unlinkSync(tmpMp3);
  }
}

module.exports = { textToVoice };
```

**Benefit:** If you change `message.txt`, the voice note automatically matches. Zero manual work.

### 6.3 Google Text-to-Speech (Alternative)

Requires Python + gTTS:

```javascript
// tts-gtts.js — Google Text-to-Speech (alternative)
'use strict';

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

async function textToVoice(text, outputPath) {
  const tmpMp3 = path.join(__dirname, 'tmp_tts.mp3');

  try {
    const ttsCmd = `python -c "from gtts import gTTS; gTTS('${text.replace(/'/g, "\\'")}', lang='bn').save('${tmpMp3}')"`;
    execSync(ttsCmd, { stdio: 'pipe' });

    const { convertToOggOpus } = require('./audio');
    convertToOggOpus(tmpMp3, outputPath);

    return outputPath;
  } finally {
    if (fs.existsSync(tmpMp3)) fs.unlinkSync(tmpMp3);
  }
}

module.exports = { textToVoice };
```

### 6.4 Pre-flight Audio Validation

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

  const ext = path.extname(voiceFile).toLowerCase();
  if (ext !== '.ogg') {
    log(`ℹ️  Voice file is ${ext} — will auto-convert to OGG/Opus on first send.`);
  }

  return true;
}
```

---

## 7. Structured Logging & Monitoring

### 7.1 Structured Logger Module

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

### 7.2 Log Rotation

Simple rotation without external dependencies:

```javascript
const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB

function rotateLogIfNeeded() {
  const logFile = CONFIG.logFile;
  if (!fs.existsSync(logFile)) return;

  const stat = fs.statSync(logFile);
  if (stat.size > MAX_LOG_BYTES) {
    const old = logFile.replace('.log', '.old.log');
    if (fs.existsSync(old)) fs.unlinkSync(old);
    fs.renameSync(logFile, old);
    writeLog(formatEntry('info', `Log rotated: ${path.basename(old)}`));
  }
}
```

### 7.3 Heartbeat File

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

// Heartbeat every 5 minutes (process alive indicator)
setInterval(() => {
  fs.writeFileSync(
    path.join(__dirname, 'heartbeat.txt'),
    new Date().toISOString()
  );
}, 5 * 60 * 1000);
```

Any external script can check if `heartbeat.txt` is more than 10 minutes old → the process has hung.

---

## 8. Process Management on Windows

### Comparison Table

| Feature | VBS (current) | VBS Watchdog | PM2 | Windows Service |
|---|---|---|---|---|
| **Background run** | ✅ | ✅ | ✅ | ✅ |
| **Crash recovery** | ❌ dies silently | ✅ basic loop | ✅ exponential backoff | ✅ SCM manages |
| **Auto-start on boot** | ⚠️ manual shortcut | ⚠️ manual shortcut | ✅ `pm2-startup` | ✅ `sc config auto` |
| **Log viewing** | ❌ open file manually | ❌ open file | ✅ `pm2 logs` | ✅ Event Viewer |
| **Status check** | ❌ Task Manager | ❌ Task Manager | ✅ `pm2 status` | ✅ `services.msc` |
| **Memory monitoring** | ❌ | ❌ | ✅ `pm2 monit` | ❌ |
| **Install effort** | None | None | `npm i -g pm2` | `npm i node-windows` |

### Recommendation A: Enhanced VBS Watchdog (Zero-Install)

If you want to stay lightweight with no new packages:

```vbs
' watchdog.vbs — auto-restarts index.js on crash
Dim oShell, sFolder
Set oShell = CreateObject("WScript.Shell")
sFolder = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
oShell.CurrentDirectory = sFolder

Do
    ' Run hidden (0), wait for exit (True)
    oShell.Run "node index.js", 0, True
    WScript.Sleep 30000  ' 30s before restart
Loop
```

### Recommendation B: PM2 (Best DX for Node.js)

```bash
npm install -g pm2 pm2-windows-startup

pm2 start index.js --name hishab-bot --restart-delay=10000
pm2-startup install
pm2 save

# Daily commands
pm2 logs hishab-bot    # live log tail
pm2 status             # is it running?
pm2 restart hishab-bot # after editing code
pm2 monit              # live CPU/memory dashboard
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

### Recommendation C: Windows Service (Runs Before User Login)

```javascript
// install-service.js
const { Service } = require('node-windows');
const svc = new Service({
  name: 'Hishab WhatsApp Bot',
  description: 'Daily expense tracking WhatsApp notifications',
  script: require('path').join(__dirname, 'index.js'),
  nodeOptions: ['--max-old-space-size=256'],
});
svc.on('install', () => { svc.start(); console.log('Service installed.'); });
svc.install();
```

Visible in `services.msc`, starts automatically even before user login.

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

## 9. Multi-Recipient & Template Engine

### 9.1 Recipients Configuration

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

### 9.2 Multi-Recipient Loader

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
      templates: {},
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

### 9.3 Variable Placeholders in Templates

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

## 10. Security & Anti-Ban Practices

### 10.1 `.gitignore`

```gitignore
# Session credentials (CRITICAL)
.wwebjs_auth/
auth_info/

# Secrets
.env

# Logs
*.log
scheduler.log
heartbeat.txt

# Generated audio
tmp_tts.mp3

# Heartbeat
.heartbeat

# Node
node_modules/

# OS
Thumbs.db
Desktop.ini
.DS_Store

# PM2
.pm2/
```

### 10.2 Anti-Ban Practices

WhatsApp detects and bans automated accounts. Minimize risk:

| Practice | Why |
|---|---|
| **Add random jitter (±2 min)** to send times | Exact-second sends look robotic |
| **Include dynamic content (date)** in messages | Identical messages trigger spam filters |
| **Send to few recipients** | Bulk sends = instant ban |
| **Keep session warm** (always connected) | Frequent connect/disconnect looks suspicious |
| **Don't use the account for other automation** | One purpose per number |
| **Send text + voice pair** | Looks like natural human behavior |

### 10.3 Session File Protection

`.wwebjs_auth/` contains full WhatsApp session credentials. Anyone with this folder can impersonate your account.

```bash
# Restrict access (Windows)
icacls .wwebjs_auth /inheritance:r /grant:r "%USERNAME%:F"
```

### 10.4 Session Backup Strategy

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

---

## 11. New Features Worth Adding

### 11.1 Delivery Confirmation Tracking

Know whether the recipient actually *read* your message:

```javascript
client.on('message_ack', (msg, ack) => {
  const labels = ['ERROR', 'PENDING', 'SERVER', 'DELIVERED', 'READ'];
  if (msg.to === CONFIG.target) {
    log(`📬 Ack: ${labels[ack] || ack}`);
  }
});
```

### 11.2 Incoming Reply Capture

Log expense reports received from the target — this is the entire *point* of the bot:

```javascript
client.on('message', async (msg) => {
  if (msg.from === CONFIG.target) {
    const dateStr = new Date().toISOString().slice(0, 10);
    const dir = path.join(__dirname, 'replies');
    fs.mkdirSync(dir, { recursive: true });

    const file = path.join(dir, `${dateStr}.txt`);
    const entry = `[${new Date().toISOString()}]\n${msg.body}\n\n`;
    fs.appendFileSync(file, entry);

    log(`📥 Reply captured → replies/${dateStr}.txt`);
  }
});
```

This creates a daily log like:
```
replies/
  2026-06-18.txt    ← today's replies
  2026-06-19.txt
  ...
```

### 11.3 Daily Summary Report

At end of day (e.g., 18:00), send yourself a summary:

```javascript
cron.schedule('0 18 * * *', async () => {
  const dateStr = new Date().toISOString().slice(0, 10);
  const replyFile = path.join(__dirname, 'replies', `${dateStr}.txt`);
  const hasReplies = fs.existsSync(replyFile);

  const summary = `📊 Daily Summary (${dateStr})
Texts sent: ✅
Voice notes sent: ✅
Replies received: ${hasReplies ? '✅' : '❌ No replies yet'}`;

  await sendTelegramAlert(summary);
}, { timezone: CONFIG.timezone });
```

### 11.4 Response Tracking (Phase 3 — Future)

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

### 11.5 Web Dashboard (Phase 3 — Future)

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

### 11.6 REST API Mode (Phase 3 — Future)

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

### 11.7 Other Future Features

| Feature | Description | Complexity |
|---------|-------------|------------|
| **Holiday calendar sync** | Auto-fetch Bangladesh govt holidays from an API | Low |
| **Weekly summary mode** | Instead of daily, send a weekly digest on Friday | Low |
| **Image attachments** | Send images alongside text (e.g., receipt photos) | Medium |
| **Multiple message variants** | Rotate between 3-4 message templates to avoid monotony | Low |
| **Monthly report** | Auto-generate and send a monthly summary of all tracked expenses | High |
| **Database backend** | Replace JSON files with SQLite for better querying | Medium |

---

## 12. Alternative Engines Deep Dive

### Comparison Table

| Feature | whatsapp-web.js | Baileys | WAHA (Docker) | Official Cloud API |
|---|---|---|---|---|
| **Architecture** | Puppeteer (headless Chrome) | Direct WebSocket | Docker container wrapping engines | Cloud REST API |
| **RAM Usage** | 200-400MB | 30-50MB | 300-500MB (Docker overhead) | 0MB (cloud) |
| **Startup Time** | 15-30s | 1-3s | 5-10s | Instant |
| **Ban Risk** | Medium (unofficial) | Medium (unofficial) | Medium (uses unofficial engines) | None (official) |
| **Setup Complexity** | Easy | Medium | Easy (Docker) | Hard (Meta approval) |
| **Voice Note Support** | Yes (OGG/Opus) | Yes (`ptt: true`) | Yes (via API) | Limited (templates only) |
| **Session Persistence** | LocalAuth (folder) | JSON file | Built-in | OAuth tokens |
| **Multi-Session** | Limited | Yes | Yes (built-in) | Yes |
| **QR Code Scan** | Yes | Yes | Yes (Web UI) | No (OAuth flow) |
| **Webhook Support** | No (polling) | No (polling) | Yes (REST + webhooks) | Yes (webhooks) |
| **Message Queue** | No | No | Yes (built-in) | Yes (official) |
| **Community** | Large, active | Large, active | Growing | Official Meta support |
| **Cost** | Free | Free | Free (self-hosted) | Free tier: 1000 convos/mo |
| **Windows Support** | Yes | Yes | Requires Docker Desktop | Yes (cloud) |
| **Maintenance** | Breaks on WA Web updates | Breaks on protocol changes | Low (Docker handles deps) | Low (Meta handles) |

### When to Consider Switching

| Scenario | Recommendation |
|---|---|
| **Low RAM machine (<4GB)** | **Baileys** — 90% less memory, 10x faster startup |
| **Want zero maintenance** | **WAHA** — Docker handles everything |
| **Need reliability for business** | **Official Cloud API** — zero ban risk |
| **Current setup works fine** | **Stay with whatsapp-web.js** — it's working |
| **Need multiple WhatsApp accounts** | **WAHA** — built-in multi-session |
| **Want REST API for external tools** | **WAHA** or **Official API** |
| **Resource-constrained desktop** | **Baileys** — clear winner for this use case |

### Baileys Migration Example

```javascript
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      log('✅ Connected via Baileys');
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        log('Reconnecting…');
        startBot();
      }
    }
  });

  // Send text
  await sock.sendMessage('8801XXXXXXXXX@s.whatsapp.net', {
    text: MESSAGE,
  });

  // Send voice note
  await sock.sendMessage('8801XXXXXXXXX@s.whatsapp.net', {
    audio: fs.readFileSync('./voice.ogg'),
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true,  // voice note mode
  });
}
```

**Key differences from whatsapp-web.js:**
- No Puppeteer/Chromium — uses WebSocket directly
- Phone number format: `@s.whatsapp.net` instead of `@c.us`
- Voice note: `ptt: true` instead of `sendAudioAsVoice: true`
- Auth: `useMultiFileAuthState` instead of `LocalAuth`
- ~80% less RAM, ~10x faster startup

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

### 🔴 Phase 1: Fix Bugs & Quick Wins (< 1 hour)

Do these today — they prevent data loss and resource leaks.

| # | Task | Time | File |
|---|---|---|---|
| 1 | Fix disconnection handler (destroy before re-init) | 5 min | `index.js:105-108` |
| 2 | Fix duplicate cron registration | 5 min | `index.js:97-102` |
| 3 | Add ready-state guard to sends | 5 min | `index.js:113-135` |
| 4 | Add graceful shutdown handlers | 5 min | `index.js` (bottom) |
| 5 | Create `.gitignore` | 2 min | new file |
| 6 | Add uncaught exception handlers | 3 min | `index.js` (bottom) |
| 7 | Create `.env` file | 5 min | new file |
| 8 | Create `.env.example` | 2 min | new file |
| 9 | Create `config.js` — load config from env | 10 min | new file |
| 10 | Create `messages/` folder — move Bengali text | 5 min | new folder + files |
| 11 | Create `templates.js` — load messages from files | 10 min | new file |
| 12 | Update `index.js` — use config + templates | 5 min | `index.js` |
| 13 | Run dry-run test | 5 min | `node index.js --dry-run` |

**Result:** You can now change target number, schedule, and messages without touching code.

---

### 🟡 Phase 2: Fire-and-Forget Reliability (1-2 days)

Do these this week — they make the bot truly autonomous.

| # | Task | Time | File |
|---|---|---|---|
| 14 | Install and configure PM2 | 15 min | `ecosystem.config.js` |
| 15 | Set up PM2 auto-start | 10 min | `pm2-windows-startup` |
| 16 | Add retry logic with backoff | 10 min | `retry.js` |
| 17 | Add anti-ban jitter | 5 min | `index.js` |
| 18 | Add Telegram notifications | 30 min | `notifier.js` |
| 19 | Upgrade `start.vbs` to watchdog loop | 5 min | `start.vbs` |
| 20 | Add audio auto-conversion | 20 min | `audio.js` |
| 21 | Add structured logging | 15 min | `logger.js` |
| 22 | Add log rotation | 10 min | `logger.js` |
| 23 | Add heartbeat file | 5 min | `index.js` |
| 24 | Add pre-flight validation | 10 min | `index.js` |
| 25 | Add `holidays.json` | 5 min | new file |
| 26 | Add startup validation | 10 min | `index.js` |

**Result:** System runs forever, recovers from crashes, alerts you on failures, converts audio automatically.

---

### 🟢 Phase 3: Intelligence Features (2-3 hours)

Do these when the basics are stable.

| # | Task | Time | File |
|---|---|---|---|
| 27 | Delivery confirmation tracking | 15 min | `index.js` |
| 28 | Incoming reply capture to `replies/` | 20 min | `index.js` |
| 29 | Dynamic date in messages | 5 min | `index.js` |
| 30 | Anti-ban jitter | 5 min | `index.js` |
| 31 | Auto audio format conversion | 20 min | `audio.js` |
| 32 | Telegram failure alerts | 30 min | `notifier.js` |
| 33 | Daily summary Telegram report | 30 min | `index.js` |

---

### 🔵 Phase 4: Architecture Upgrades (Half day)

Do these when you want to level up.

| # | Task | Time |
|---|---|---|
| 34 | Multi-recipient support | 30 min |
| 35 | Variable placeholders in templates | 15 min |
| 36 | Migrate from whatsapp-web.js to Baileys | 2 hours |
| 37 | Switch to PM2 for process management | 15 min |
| 38 | Add TTS voice generation (edge-tts) | 1 hour |
| 39 | Web dashboard (Express) | 2 hours |
| 40 | REST API mode | 1 hour |
| 41 | Response tracking (SQLite) | 2 hours |
| 42 | Consider WAHA migration | evaluation |

---

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
| `tts.js` | 2 | Text-to-speech (edge-tts) |
| `logger.js` | 2 | Structured logging |
| `recipients.js` | 4 | Multi-recipient loader |
| `recipients.json` | 4 | Recipient configurations |
| `holidays.json` | 2 | Holiday skip list |
| `ecosystem.config.js` | 2 | PM2 configuration |
| `start.vbs` | 1+2 | Watchdog launcher |
| `index.js` | 1+2 | Update to use new modules |

---

> **Bottom line:** Phase 1 (bug fixes + quick wins) takes under 1 hour and eliminates critical bugs. Phase 2 (fire-and-forget) takes 1-2 days and makes the system truly autonomous. Phase 3 adds intelligence (reply capture, delivery tracking). Phase 4 is a strategic rewrite for long-term stability and lower resource usage. Start with Phase 1 today.
