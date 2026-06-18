'use strict';

const fs   = require('fs');
const path = require('path');

function validate(logger) {
  const checks = [
    {
      name: 'Node.js version',
      ok: () => process.version >= 'v18',
      msg: `Node.js ≥ 18 required (current: ${process.version})`,
    },
    {
      name: 'Config file',
      ok: () => fs.existsSync(path.join(__dirname, '.env')),
      msg: 'Missing .env — copy .env.example to .env',
    },
    {
      name: 'Target phone',
      ok: () => {
        try { return require('./config').target !== '8801XXXXXXXXX@c.us'; } catch (_) { return false; }
      },
      msg: 'Target phone still placeholder — edit .env',
    },
    {
      name: 'Message templates',
      ok: () => {
        const dir = path.join(__dirname, 'messages');
        const files = ['morning-text.txt', 'morning-voice.txt', 'afternoon-text.txt', 'afternoon-voice.txt'];
        return files.every(f => fs.existsSync(path.join(dir, f)));
      },
      msg: 'Missing message templates in messages/ folder',
    },
    {
      name: 'Voice file',
      ok: () => {
        try { return fs.existsSync(require('./config').voiceFile); } catch (_) { return false; }
      },
      msg: 'voice.ogg not found — optional, voice sends will be skipped',
      warn: true,
    },
  ];

  let ok = true;
  logger.info('── Startup validation ──');
  for (const c of checks) {
    if (c.ok()) {
      logger.info(`  ✅ ${c.name}`);
    } else if (c.warn) {
      logger.warn(`  ⚠️  ${c.name}: ${c.msg}`);
    } else {
      logger.error(`  ❌ ${c.name}: ${c.msg}`);
      ok = false;
    }
  }
  logger.info('───────────────────────');
  return ok;
}

module.exports = validate;
