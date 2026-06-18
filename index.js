// ╔══════════════════════════════════════════════════════════════════╗
// ║         WhatsApp Accounts Notice Scheduler                       ║
// ║  whatsapp-web.js@1.34.7 | node-cron@4.3.0 | Node.js ≥ 18       ║
// ╚══════════════════════════════════════════════════════════════════╝

'use strict';

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron   = require('node-cron');
const path   = require('path');
const fs     = require('fs');

// ┌─────────────────────────────────────────────────────────────────┐
// │  CONFIGURATION — loaded from .env via config.js                 │
// └─────────────────────────────────────────────────────────────────┘
const CONFIG = require('./config');

// ┌─────────────────────────────────────────────────────────────────┐
// │  MESSAGE TEMPLATES — loaded from messages/*.txt                 │
// └─────────────────────────────────────────────────────────────────┘
const { loadMessage } = require('./templates');

const TEMPLATES = {
  morningText:    loadMessage('morning-text.txt'),
  morningVoice:   loadMessage('morning-voice.txt'),
  afternoonText:  loadMessage('afternoon-text.txt'),
  afternoonVoice: loadMessage('afternoon-voice.txt'),
};

// ┌─────────────────────────────────────────────────────────────────┐
// │  TELEGRAM NOTIFICATIONS                                          │
// └─────────────────────────────────────────────────────────────────┘
const TelegramNotifier = require('./notifications');
const notifier = new TelegramNotifier(CONFIG.telegram.botToken, CONFIG.telegram.chatId);

for (const [key, tpl] of Object.entries(TEMPLATES)) {
  if (!tpl) console.error(`   ⚠️  ${key} template missing — will skip on schedule`);
}

// ┌─────────────────────────────────────────────────────────────────┐
// │  LOGGER — writes to both console and scheduler.log              │
// └─────────────────────────────────────────────────────────────────┘
const Logger = require('./logger');
const logger = new Logger({ logFile: CONFIG.logFile, timezone: CONFIG.timezone, level: CONFIG.logLevel });

function log(msg) { logger.info(msg); }

// ┌─────────────────────────────────────────────────────────────────┐
// │  CLIENT STATE TRACKING                                           │
// └─────────────────────────────────────────────────────────────────┘
let clientReady = false;
let cronRegistered = false;
let consecutiveFailures = 0;

// ┌─────────────────────────────────────────────────────────────────┐
// │  WHATSAPP CLIENT                                                 │
// └─────────────────────────────────────────────────────────────────┘
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'accounts-scheduler' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

// First launch: show QR code to scan
client.on('qr', (qr) => {
  console.log('\n══════════════════════════════════════════════════');
  console.log(' Open WhatsApp on your phone → Linked Devices     ');
  console.log(' → Link a Device → Scan this code:                ');
  console.log('══════════════════════════════════════════════════\n');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  log('✅ Authenticated — session saved to .wwebjs_auth (no re-scan needed).');
  consecutiveFailures = 0;
});

client.on('auth_failure', (msg) => {
  log(`❌ Authentication failed: ${msg}`);
  log('   → Delete the .wwebjs_auth folder and restart to re-scan QR.');
  process.exit(1);
});

client.on('ready', () => {
  log('✅ WhatsApp client ready.');
  log(`   Target: ${CONFIG.target}`);
  log(`   Timezone: ${CONFIG.timezone}`);
  clientReady = true;
  if (!cronRegistered) {
    registerCronJobs();
    cronRegistered = true;
  } else {
    log('   Cron jobs already active (not re-registering).');
  }
});

// Auto-reconnect if the session drops
client.on('disconnected', async (reason) => {
  log(`⚠️  Disconnected (${reason}). Cleaning up…`);
  clientReady = false;
  consecutiveFailures++;
  try {
    await client.destroy();
  } catch (e) {
    log(`   Destroy error (safe to ignore): ${e.message}`);
  }
  const delay = Math.min(10000 * Math.pow(2, consecutiveFailures - 1), 300000);
  log(`   Re-initializing in ${delay / 1000}s…`);
  setTimeout(() => client.initialize(), delay);
});

// ┌─────────────────────────────────────────────────────────────────┐
// │  UTILITIES                                                        │
// └─────────────────────────────────────────────────────────────────┘
function isHoliday() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: CONFIG.timezone });
  return CONFIG.holidays.includes(today);
}

function jitter(ms) {
  const delay = Math.floor(Math.random() * ms);
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function resolveVoiceFile() {
  const oggPath = CONFIG.voiceFile;
  const mp3Path = oggPath.replace(/\.ogg$/i, '.mp3');
  const ttsText = TEMPLATES.morningVoice;

  // 1. OGG exists → use it
  if (fs.existsSync(oggPath)) {
    log('   Using voice.ogg');
    return oggPath;
  }

  // 2. MP3 exists → convert to OGG
  if (fs.existsSync(mp3Path)) {
    log('   voice.ogg not found, converting voice.mp3 → voice.ogg…');
    const { execFile } = require('child_process');
    await new Promise((resolve) => {
      execFile('ffmpeg', ['-y', '-i', mp3Path, '-c:a', 'libopus', '-b:a', '32k', '-ac', '1', oggPath],
        { timeout: 15000 }, (err) => resolve(!err));
    });
    if (fs.existsSync(oggPath)) {
      log('   ✅ Conversion successful.');
      return oggPath;
    }
    log('   ⚠️  ffmpeg conversion failed, using MP3 as fallback.');
    return mp3Path;
  }

  // 3. Neither exists → generate via edge-tts
  if (ttsText) {
    log('   No voice file found — generating via Edge-TTS…');
    const tts = require('./tts');
    const available = await tts.isAvailable();
    if (available) {
      try {
        const outFile = await tts.generate(ttsText);
        log('   ✅ Voice file generated.');
        return outFile;
      } catch (err) {
        log(`   ❌ TTS generation failed: ${err.message}`);
      }
    } else {
      log('   ❌ edge-tts not available. Install: pip install edge-tts');
    }
  }

  return null;
}

// ┌─────────────────────────────────────────────────────────────────┐
// │  SEND HELPERS                                                    │
// └─────────────────────────────────────────────────────────────────┘
async function sendText(templateName) {
  if (!clientReady) {
    log('⏳ Client not ready — skipping text send.');
    return;
  }
  if (isHoliday()) {
    log(`🎌 Holiday — skipping ${templateName}.`);
    return;
  }
  const msg = TEMPLATES[templateName];
  if (!msg) {
    log(`⚠️  No template loaded for ${templateName} — skipping.`);
    return;
  }
  await jitter(120000); // 0-120s random delay
  try {
    await client.sendMessage(CONFIG.target, msg);
    log(`📨 ${templateName} sent successfully.`);
    await notifier.send(`✅ ${templateName} sent successfully.`);
  } catch (err) {
    log(`❌ ${templateName} send failed: ${err.message}`);
    await notifier.send(`❌ ${templateName} failed: ${err.message}`);
  }
}

async function sendVoice(templateName) {
  if (!clientReady) {
    log('⏳ Client not ready — skipping voice send.');
    return;
  }
  if (isHoliday()) {
    log(`🎌 Holiday — skipping ${templateName}.`);
    return;
  }
  const voicePath = await resolveVoiceFile();
  if (!voicePath) {
    log('❌ No voice file available — skipping voice send.');
    return;
  }
  await jitter(120000); // 0-120s random delay
  try {
    const media = MessageMedia.fromFilePath(voicePath);
    await client.sendMessage(CONFIG.target, media, { sendAudioAsVoice: true });
    log(`🎙️  ${templateName} sent successfully.`);
    await notifier.send(`✅ ${templateName} sent successfully.`);
  } catch (err) {
    log(`❌ ${templateName} send failed: ${err.message}`);
    await notifier.send(`❌ ${templateName} failed: ${err.message}`);
  }
}

// ┌─────────────────────────────────────────────────────────────────┐
// │  CRON SCHEDULES — node-cron v4 with timezone support            │
// └─────────────────────────────────────────────────────────────────┘
function registerCronJobs() {
  const opts = { timezone: CONFIG.timezone };

  cron.schedule(CONFIG.schedules.morningText,    () => sendText('morningText'),    opts);
  cron.schedule(CONFIG.schedules.morningVoice,   () => sendVoice('morningVoice'),   opts);
  cron.schedule(CONFIG.schedules.afternoonText,  () => sendText('afternoonText'),  opts);
  cron.schedule(CONFIG.schedules.afternoonVoice, () => sendVoice('afternoonVoice'), opts);

  log('📅 Active schedules (Asia/Dhaka / BST):');
  for (const [key, cronExpr] of Object.entries(CONFIG.schedules)) {
    log(`   ${cronExpr} → ${key}`);
  }
  log('Keep this process running. All sends are logged to scheduler.log');
}

// ┌─────────────────────────────────────────────────────────────────┐
// │  GRACEFUL SHUTDOWN                                               │
// └─────────────────────────────────────────────────────────────────┘
async function shutdown(signal) {
  log(`🛑 ${signal} — shutting down…`);
  try { await client.destroy(); } catch (_) {}
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  log(`💥 Uncaught exception: ${err.message}\n${err.stack}`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log(`💥 Unhandled rejection: ${reason}`);
});

// ┌─────────────────────────────────────────────────────────────────┐
// │  START                                                           │
// └─────────────────────────────────────────────────────────────────┘
const validate = require('./validate');
if (!validate(logger)) {
  logger.error('Startup validation failed — fix the issues above and restart.');
  process.exit(1);
}

log('🚀 WhatsApp Accounts Scheduler starting…');
client.initialize();
