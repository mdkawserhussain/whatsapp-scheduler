'use strict';

const fs   = require('fs');
const path = require('path');
const tts  = require('./tts');

const msgFile = path.join(__dirname, 'messages', 'morning-voice.txt');

async function main() {
  console.log('🎙️  Generating voice file with Edge-TTS…');

  const available = await tts.isAvailable();
  if (!available) {
    console.error('❌ edge-tts not found. Install with: pip install edge-tts');
    process.exit(1);
  }

  if (!fs.existsSync(msgFile)) {
    console.error(`❌ Message file not found: ${msgFile}`);
    process.exit(1);
  }

  const text = fs.readFileSync(msgFile, 'utf-8').trim();
  console.log(`   Text: ${text.substring(0, 60)}…`);

  try {
    const outFile = await tts.generate(text);
    console.log(`✅ Voice file generated: ${outFile}`);
  } catch (err) {
    console.error(`❌ Generation failed: ${err.message}`);
    process.exit(1);
  }
}

main();
