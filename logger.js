'use strict';

const fs   = require('fs');
const path = require('path');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  constructor(opts = {}) {
    this.logFile  = opts.logFile || path.join(__dirname, 'scheduler.log');
    this.timezone = opts.timezone || 'Asia/Dhaka';
    this.level    = LEVELS[opts.level] ?? 1;
    this.maxSize  = opts.maxSize || 5 * 1024 * 1024; // 5 MB
    this._writeCount = 0;
    this._rotateEvery = 100;
  }

  _ts() {
    return new Date().toLocaleString('bn-BD', { timeZone: this.timezone });
  }

  _rotate() {
    try {
      const stat = fs.statSync(this.logFile);
      if (stat.size < this.maxSize) return;
      const rotated = this.logFile.replace('.log', `-${Date.now()}.log`);
      fs.renameSync(this.logFile, rotated);
    } catch (_) {}
  }

  _write(level, msg) {
    if (LEVELS[level] < this.level) return;
    const line = `[${this._ts()}] ${level.toUpperCase()} ${msg}`;
    console.log(line);
    try {
      this._writeCount++;
      if (this._writeCount % this._rotateEvery === 0) {
        this._rotate();
      }
      fs.appendFileSync(this.logFile, line + '\n');
    } catch (writeErr) {
      console.error(`[Logger] Write failed: ${writeErr.message}`);
    }
  }

  debug(msg) { this._write('debug', msg); }
  info(msg)  { this._write('info', msg); }
  warn(msg)  { this._write('warn', msg); }
  error(msg) { this._write('error', msg); }
}

module.exports = Logger;
