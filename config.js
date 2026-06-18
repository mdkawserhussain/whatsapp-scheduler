'use strict';

require('dotenv').config();
const path = require('path');
const fs   = require('fs');

const required = ['TARGET_PHONE'];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing required env variable: ${key}`);
    console.error('   Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}

const holidaysPath = path.join(__dirname, 'holidays.json');
const holidays = fs.existsSync(holidaysPath)
  ? Object.keys(JSON.parse(fs.readFileSync(holidaysPath, 'utf-8')))
  : [];

module.exports = {
  target:    process.env.TARGET_PHONE,
  timezone:  process.env.TIMEZONE || 'Asia/Dhaka',
  voiceFile: path.join(__dirname, process.env.VOICE_FILE || 'voice.ogg'),
  logLevel:  process.env.LOG_LEVEL || 'info',
  logFile:   path.join(__dirname, process.env.LOG_FILE || 'scheduler.log'),
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
