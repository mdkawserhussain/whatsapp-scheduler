'use strict';

const https = require('https');

const TELEGRAM_API = 'https://api.telegram.org';

class TelegramNotifier {
  constructor(botToken, chatId) {
    this.botToken = botToken;
    this.chatId   = chatId;
    this.enabled  = !!(botToken && chatId);
  }

  async send(message) {
    if (!this.enabled) return;
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
    const body = JSON.stringify({
      chat_id: Number(this.chatId) || this.chatId,
      text:    message,
      parse_mode: 'HTML',
    });

    return new Promise((resolve) => {
      const req = https.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve({ ok: res.statusCode === 200, data }));
      });
      req.on('error', () => resolve({ ok: false, data: 'request failed' }));
      req.write(body);
      req.end();
    });
  }
}

module.exports = TelegramNotifier;
