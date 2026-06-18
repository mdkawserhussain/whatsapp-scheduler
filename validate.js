'use strict';

const fs    = require('fs');
const path  = require('path');
const cron  = require('node-cron');
const CONFIG = require('./config');

function validate(logger) {
  const checks = [
    {
      name: 'Node.js version',
      ok: () => {
        const major = parseInt(process.version.slice(1), 10);
        return Number.isFinite(major) && major >= 18;
      },
      msg: `Node.js ≥ 18 required (current: ${process.version})`,
    },
    {
      name: 'Config file',
      ok: () => fs.existsSync(path.join(__dirname, '.env')),
      msg: 'Missing .env — copy .env.example to .env',
    },
    {
      name: 'Target phone',
      ok: () => CONFIG.target !== '8801XXXXXXXXX@c.us',
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
      ok: () => fs.existsSync(CONFIG.voiceFile),
      msg: 'voice.ogg not found — optional, voice sends will be skipped',
      warn: true,
    },
    {
      name: 'Cron expressions',
      ok: () => {
        return Object.entries(CONFIG.schedules).every(([key, expr]) => {
          if (!cron.validate(expr)) {
            logger.error(`  ❌ Invalid cron for ${key}: "${expr}"`);
            return false;
          }
          return true;
        });
      },
      msg: 'Invalid cron expression in .env — check schedule format',
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
