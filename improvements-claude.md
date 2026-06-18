# WhatsApp Accounts Scheduler — Improvements & Alternatives (Claude Analysis)

> **Scope:** Full analysis of [index.js](file:///d:/Rasel/dis-docs/hr/hishab-whatsapp/index.js), [setup.bat](file:///d:/Rasel/dis-docs/hr/hishab-whatsapp/setup.bat), [start.vbs](file:///d:/Rasel/dis-docs/hr/hishab-whatsapp/start.vbs), and the planning notes in [draft.md](file:///d:/Rasel/dis-docs/hr/hishab-whatsapp/draft.md).
> **Date:** 2026-06-18

---

## Table of Contents

1. [Current Architecture Assessment](#1-current-architecture-assessment)
2. [Critical Bugs to Fix Immediately](#2-critical-bugs-to-fix-immediately)
3. [Code Quality & Maintainability](#3-code-quality--maintainability)
4. [Reliability & Fault Tolerance](#4-reliability--fault-tolerance)
5. [New Features Worth Adding](#5-new-features-worth-adding)
6. [Audio Pipeline Automation](#6-audio-pipeline-automation)
7. [Process Management on Windows](#7-process-management-on-windows)
8. [Alternative WhatsApp Engines](#8-alternative-whatsapp-engines)
9. [Security Hardening](#9-security-hardening)
10. [Prioritized Roadmap](#10-prioritized-roadmap)

---

## 1. Current Architecture Assessment

### How it works today

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

### What's solid

| ✅ Strength | Detail |
|---|---|
| Config object | All tunables (`target`, `timezone`, `schedules`) grouped in one `CONFIG` block |
| Session persistence | `LocalAuth` saves QR session to `.wwebjs_auth/` — scan once, never again |
| Timezone-aware cron | `node-cron@4.3.0` has native `timezone` option — no manual UTC offset math |
| Dual logging | Every event writes to both `console` and `scheduler.log` with Bengali timestamps |
| Voice file guard | `fs.existsSync()` check before attempting to send `voice.ogg` |
| Silent launcher | `start.vbs` runs Node with zero visible windows |

### What's broken or fragile

| ❌ Issue | Severity | Why it matters |
|---|---|---|
| Reconnection creates zombie Chromium processes | **Critical** | `client.initialize()` called without `client.destroy()` first — stacks memory |
| Cron jobs re-register on every reconnect | **Critical** | Causes duplicate sends (2x, 3x, 4x...) after each disconnect/reconnect cycle |
| No send-readiness guard | **High** | If client is mid-reconnect when cron fires, the send throws an unhandled error |
| No retry on send failure | **High** | A single network blip = message permanently lost |
| No external notification on failure | **High** | Script runs silently — if QR re-scan is needed, nobody knows |
| `scheduler.log` grows forever | **Medium** | No rotation — disk fills up over months |
| Hardcoded phone number in source | **Medium** | Risk if code is ever shared or version-controlled |
| Hardcoded message in source | **Low** | Editing the Bangla text requires opening `index.js` |
| No `.gitignore` | **Low** | `.wwebjs_auth/`, `node_modules/`, logs could leak to git |
| No graceful shutdown | **Low** | Ctrl+C orphans the Chromium process |

---

## 2. Critical Bugs to Fix Immediately

### Bug 1: Disconnection handler causes memory leak

**Location:** [index.js:105-108](file:///d:/Rasel/dis-docs/hr/hishab-whatsapp/index.js#L105-L108)

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

**Location:** [index.js:97-102](file:///d:/Rasel/dis-docs/hr/hishab-whatsapp/index.js#L97-L102)

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

## 3. Code Quality & Maintainability

### 3.1 Externalize config to `.env`

Separate secrets and tunables from code using `dotenv`:

**`.env` file:**
```env
TARGET_NUMBER=8801XXXXXXXXX@c.us
TIMEZONE=Asia/Dhaka
VOICE_FILE=voice.ogg

CRON_MORNING_TEXT=30 9 * * *
CRON_MORNING_VOICE=0 10 * * *
CRON_AFTERNOON_TEXT=0 14 * * *
CRON_AFTERNOON_VOICE=30 14 * * *
```

**In `index.js`:**
```javascript
require('dotenv').config();

const CONFIG = {
  target:    process.env.TARGET_NUMBER || '8801XXXXXXXXX@c.us',
  voiceFile: path.join(__dirname, process.env.VOICE_FILE || 'voice.ogg'),
  timezone:  process.env.TIMEZONE || 'Asia/Dhaka',
  schedules: {
    morningText:    process.env.CRON_MORNING_TEXT    || '30 9 * * *',
    morningVoice:   process.env.CRON_MORNING_VOICE   || '0 10 * * *',
    afternoonText:  process.env.CRON_AFTERNOON_TEXT  || '0 14 * * *',
    afternoonVoice: process.env.CRON_AFTERNOON_VOICE || '30 14 * * *',
  },
};
```

**Install:** `npm install dotenv`

### 3.2 Move the message body to `message.txt`

Let non-technical users edit the Bangla message without touching JavaScript:

```javascript
const MESSAGE_PATH = path.join(__dirname, 'message.txt');
const MESSAGE = fs.readFileSync(MESSAGE_PATH, 'utf-8').trim();
```

### 3.3 Add startup validation

Catch misconfiguration before the client even starts:

```javascript
function validateConfig() {
  const errors = [];

  if (!CONFIG.target || CONFIG.target.includes('XXXX'))
    errors.push('TARGET_NUMBER not set — edit .env file');

  if (!fs.existsSync(CONFIG.voiceFile))
    errors.push(`Voice file missing: ${CONFIG.voiceFile}`);

  if (!fs.existsSync(MESSAGE_PATH))
    errors.push(`Message file missing: ${MESSAGE_PATH}`);

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

### 3.4 Log rotation

Prevent `scheduler.log` from growing forever:

```javascript
const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB

function log(msg) {
  const ts   = new Date().toLocaleString('bn-BD', { timeZone: CONFIG.timezone });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    // Rotate if oversized
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > MAX_LOG_BYTES) {
      const old = LOG_PATH.replace('.log', '.old.log');
      if (fs.existsSync(old)) fs.unlinkSync(old);
      fs.renameSync(LOG_PATH, old);
    }
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch (_) {}
}
```

### 3.5 Graceful shutdown handlers

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

## 4. Reliability & Fault Tolerance

### 4.1 Retry with exponential backoff

Don't give up after one failure:

```javascript
async function withRetry(fn, label, maxAttempts = 3) {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      await fn();
      return;
    } catch (err) {
      const delay = i * 5000; // 5s, 10s, 15s
      log(`❌ ${label} attempt ${i}/${maxAttempts}: ${err.message}`);
      if (i < maxAttempts) {
        log(`   Retrying in ${delay / 1000}s…`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  log(`❌ ${label} failed permanently after ${maxAttempts} attempts.`);
}

// Usage
async function sendText() {
  if (!clientReady) return;
  await withRetry(
    () => client.sendMessage(CONFIG.target, MESSAGE),
    'Text message'
  );
  log('📨 Text sent.');
}
```

### 4.2 Anti-ban jitter

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

### 4.3 Heartbeat file for external monitoring

A simple "am I alive?" indicator:

```javascript
setInterval(() => {
  fs.writeFileSync(
    path.join(__dirname, 'heartbeat.txt'),
    new Date().toISOString()
  );
}, 5 * 60 * 1000); // every 5 minutes
```

Any external script can check if `heartbeat.txt` is more than 10 minutes old → the process has hung.

### 4.4 Telegram alert on critical failures

When the bot needs human attention (QR re-scan, repeated failures), alert via Telegram — the only channel guaranteed to reach you when WhatsApp itself is broken:

```javascript
const https = require('https');

async function alertTelegram(text) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const payload = JSON.stringify({
    chat_id: chatId,
    text: `🤖 WhatsApp Bot Alert\n\n${text}`,
    parse_mode: 'Markdown',
  });

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  return new Promise((resolve) => {
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, resolve);
    req.on('error', () => {}); // fail silently
    req.write(payload);
    req.end();
  });
}

// Integrate:
client.on('qr', async (qr) => {
  await alertTelegram('⚠️ *Session expired!* QR re-scan needed.\nRun `node index.js` in a terminal.');
  qrcode.generate(qr, { small: true });
});

client.on('auth_failure', async (msg) => {
  await alertTelegram(`❌ *Auth failed:* ${msg}\nDelete .wwebjs_auth/ and restart.`);
});
```

---

## 5. New Features Worth Adding

### 5.1 Delivery confirmation tracking

Know whether the recipient actually *read* your message:

```javascript
client.on('message_ack', (msg, ack) => {
  const labels = ['ERROR', 'PENDING', 'SERVER', 'DELIVERED', 'READ'];
  if (msg.to === CONFIG.target) {
    log(`📬 Ack: ${labels[ack] || ack}`);
  }
});
```

### 5.2 Incoming reply capture

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

### 5.3 Dynamic date in message

Makes each message unique (also helps avoid WhatsApp's spam detection):

```javascript
function buildMessage() {
  const today = new Date().toLocaleDateString('bn-BD', {
    timeZone: CONFIG.timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const baseMsg = fs.readFileSync(MESSAGE_PATH, 'utf-8').trim();
  return `📅 ${today}\n\n${baseMsg}`;
}
```

### 5.4 Friday / holiday skipping

Bangladesh weekend is Friday. Don't send on holidays:

```javascript
// Option A: Cron expression (simple — excludes Friday)
'30 9 * * 0-4,6'  // Sun-Thu + Sat

// Option B: Runtime check (flexible — supports custom holidays)
const HOLIDAYS = ['2026-12-16', '2026-03-26']; // Victory Day, Independence Day

function shouldSkipToday() {
  const now = new Date();
  const day = now.getDay();
  const dateStr = now.toISOString().slice(0, 10);

  if (day === 5) return 'Friday (weekend)';
  if (HOLIDAYS.includes(dateStr)) return `Holiday (${dateStr})`;
  return false;
}
```

### 5.5 Multi-recipient support

Send to multiple department heads with a single config change:

```javascript
// .env
TARGETS=8801XXXXXXXXX@c.us,8801YYYYYYYYY@c.us

// index.js
const targets = (process.env.TARGETS || CONFIG.target).split(',').map(t => t.trim());

async function sendText() {
  for (const target of targets) {
    await withRetry(() => client.sendMessage(target, buildMessage()), `Text→${target}`);
  }
}
```

### 5.6 Daily summary report

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

  await alertTelegram(summary);
}, { timezone: CONFIG.timezone });
```

---

## 6. Audio Pipeline Automation

### Current pain point

The user must manually run `ffmpeg` commands to convert audio to OGG/Opus format. This is error-prone and non-obvious.

### Auto-conversion on startup

```javascript
const { execSync } = require('child_process');

function ensureOggOpus(inputPath) {
  if (!fs.existsSync(inputPath)) return null;

  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.ogg') return inputPath; // already correct format

  const outputPath = inputPath.replace(/\.[^.]+$/, '.ogg');
  log(`🔄 Converting ${ext} → OGG/Opus…`);

  try {
    execSync(
      `ffmpeg -y -i "${inputPath}" -c:a libopus -b:a 32k -ac 1 -ar 48000 "${outputPath}"`,
      { stdio: 'pipe' }
    );
    log(`✅ Converted: ${path.basename(outputPath)}`);
    return outputPath;
  } catch (err) {
    log(`❌ FFmpeg conversion failed: ${err.message}`);
    log('   Install ffmpeg: winget install ffmpeg');
    return null;
  }
}
```

### Dynamic TTS voice generation

Generate the voice note from the text message itself — no pre-recorded file needed. Uses Microsoft Edge TTS (free, supports Bengali, no API key):

```bash
# One-time install
pip install edge-tts
```

```javascript
function generateVoiceFromText(text, outputPath) {
  // edge-tts supports bn-BD-NabanitaNeural (female) and bn-BD-PradeepNeural (male)
  const escaped = text.replace(/"/g, '\\"');
  execSync(
    `edge-tts --voice bn-BD-NabanitaNeural --text "${escaped}" --write-media "${outputPath.replace('.ogg', '.mp3')}"`,
    { stdio: 'pipe' }
  );
  // Convert to OGG/Opus
  return ensureOggOpus(outputPath.replace('.ogg', '.mp3'));
}
```

**Benefit:** If you change `message.txt`, the voice note automatically matches. Zero manual work.

---

## 7. Process Management on Windows

### Comparison

| | `start.vbs` (current) | VBS Watchdog | PM2 | Windows Service |
|---|---|---|---|---|
| Background run | ✅ | ✅ | ✅ | ✅ |
| Crash recovery | ❌ dies silently | ✅ basic loop | ✅ exponential backoff | ✅ SCM manages |
| Auto-start on boot | ⚠️ manual shortcut | ⚠️ manual shortcut | ✅ `pm2-startup` | ✅ `sc config auto` |
| Log viewing | ❌ open file manually | ❌ open file | ✅ `pm2 logs` | ✅ Event Viewer |
| Status check | ❌ Task Manager | ❌ Task Manager | ✅ `pm2 status` | ✅ `services.msc` |
| Memory monitoring | ❌ | ❌ | ✅ `pm2 monit` | ❌ |
| Install effort | None | None | `npm i -g pm2` | `npm i node-windows` |

### Recommendation A: Enhanced VBS Watchdog (zero-install)

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

### Recommendation B: PM2 (best DX for Node.js)

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

### Recommendation C: Windows Service (runs before user login)

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

---

## 8. Alternative WhatsApp Engines

### Why consider switching from `whatsapp-web.js`?

1. **RAM:** Puppeteer/Chromium consumes 200-400 MB for a task that sends 4 messages/day
2. **Fragility:** Breaks whenever WhatsApp updates its Web UI (DOM structure changes)
3. **Startup time:** 15-30 seconds to launch headless Chrome vs. <2 seconds for socket-based alternatives

### Engine comparison

| | whatsapp-web.js (current) | Baileys | WAHA (Docker) | Official Business API |
|---|---|---|---|---|
| **How it works** | Puppeteer driving WhatsApp Web | Direct WebSocket protocol | REST API over Docker | Meta cloud API |
| **RAM** | 200-400 MB | 30-50 MB | 100-200 MB | 0 (cloud) |
| **Startup** | 15-30s | 1-3s | 5-10s | Instant |
| **Ban risk** | Medium | Medium | Medium | None |
| **Voice notes** | ✅ `sendAudioAsVoice` | ✅ `ptt: true` | ✅ REST endpoint | ⚠️ Templates only |
| **Maintenance** | Breaks on WA Web updates | Breaks on protocol changes | Maintained by project | Maintained by Meta |
| **Setup** | Easy | Easy | Needs Docker | Business account + verification |
| **Cost** | Free | Free | Free core / paid pro | Free 1K convos/month |
| **Best for** | Prototyping | **Resource-constrained desktops** | Multi-bot deployments | Production/enterprise |

### Top recommendation: Baileys

For this project (single bot, Windows desktop, 4 messages/day), Baileys is the clear winner:

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

---

## 9. Security Hardening

### 9.1 `.gitignore` (create immediately)

```gitignore
# Session credentials (CRITICAL)
.wwebjs_auth/
auth_info/

# Secrets
.env

# Logs
*.log
heartbeat.txt

# Node
node_modules/

# OS
Thumbs.db
desktop.ini
```

### 9.2 Anti-ban practices

WhatsApp detects and bans automated accounts. Minimize risk:

| Practice | Why |
|---|---|
| Add random jitter (±2 min) to send times | Exact-second sends look robotic |
| Include dynamic content (date) in messages | Identical messages trigger spam filters |
| Send to few recipients | Bulk sends = instant ban |
| Keep session warm (always connected) | Frequent connect/disconnect looks suspicious |
| Don't use the account for other automation | One purpose per number |

### 9.3 Session file protection

`.wwebjs_auth/` contains full WhatsApp session credentials. Anyone with this folder can impersonate your account.

```bash
# Restrict access (Windows)
icacls .wwebjs_auth /inheritance:r /grant:r "%USERNAME%:F"
```

---

## 10. Prioritized Roadmap

### 🔴 Phase 1: Fix bugs (30 minutes)

Do these today — they prevent data loss and resource leaks.

| # | Task | Time | File |
|---|---|---|---|
| 1 | Fix disconnection handler (destroy before re-init) | 5 min | `index.js:105-108` |
| 2 | Fix duplicate cron registration | 5 min | `index.js:97-102` |
| 3 | Add ready-state guard to sends | 5 min | `index.js:113-135` |
| 4 | Add graceful shutdown handlers | 5 min | `index.js` (bottom) |
| 5 | Create `.gitignore` | 2 min | new file |
| 6 | Add uncaught exception handlers | 3 min | `index.js` (bottom) |

### 🟡 Phase 2: Improve reliability (1 hour)

Do these this week — they make the bot truly fire-and-forget.

| # | Task | Time | File |
|---|---|---|---|
| 7 | Install `dotenv`, move config to `.env` | 15 min | `index.js`, `.env` |
| 8 | Move message to `message.txt` | 5 min | `index.js`, `message.txt` |
| 9 | Add retry with backoff | 10 min | `index.js` |
| 10 | Add log rotation | 10 min | `index.js` |
| 11 | Add startup validation | 10 min | `index.js` |
| 12 | Upgrade `start.vbs` to watchdog loop | 5 min | `start.vbs` |

### 🟢 Phase 3: Add features (2-3 hours)

Do these when the basics are stable.

| # | Task | Time | File |
|---|---|---|---|
| 13 | Delivery confirmation tracking | 15 min | `index.js` |
| 14 | Incoming reply capture to `replies/` | 20 min | `index.js` |
| 15 | Dynamic date in messages | 5 min | `index.js` |
| 16 | Friday/holiday skipping | 10 min | `index.js` |
| 17 | Anti-ban jitter | 5 min | `index.js` |
| 18 | Auto audio format conversion | 20 min | `index.js` or `audio.js` |
| 19 | Telegram failure alerts | 30 min | `notifier.js` |

### 🔵 Phase 4: Architecture upgrades (half day)

Do these when you want to level up.

| # | Task | Time |
|---|---|---|
| 20 | Migrate from whatsapp-web.js to Baileys | 2 hours |
| 21 | Switch to PM2 for process management | 15 min |
| 22 | Add TTS voice generation (edge-tts) | 1 hour |
| 23 | Multi-recipient support | 30 min |
| 24 | Daily summary Telegram report | 30 min |

---

> **Bottom line:** Phases 1-2 (bug fixes + reliability) can be done in under 2 hours and will transform this from "works if nothing goes wrong" to "genuinely fire-and-forget." Phase 3 adds intelligence (reply capture, delivery tracking). Phase 4 is a strategic rewrite for long-term stability and lower resource usage.
