'use strict';

const fs   = require('fs');
const path = require('path');

const MESSAGES_DIR = path.join(__dirname, 'messages');

function loadMessage(filename) {
  const filePath = path.join(MESSAGES_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Message file not found: ${filePath}`);
    return null;
  }
  return fs.readFileSync(filePath, 'utf-8').trim();
}

function fillTemplate(template, data) {
  return template.replace(/\{(\w+)\}/g, (_, key) => data[key] ?? `{${key}}`);
}

module.exports = { loadMessage, fillTemplate, MESSAGES_DIR };
