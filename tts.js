'use strict';

const { execFile } = require('child_process');
const path = require('path');
const fs   = require('fs');

const OUTPUT_FILE = path.join(__dirname, 'voice.ogg');
const VOICE = 'bn-BD-NayeemNeural'; // Bengali male voice

function generate(text) {
  return new Promise((resolve, reject) => {
    if (!text || !text.trim()) {
      return reject(new Error('No text provided for TTS'));
    }

    // Write text to temp file to avoid shell escaping issues
    const tmpFile = path.join(__dirname, '.tts-input.txt');
    fs.writeFileSync(tmpFile, text, 'utf-8');

    // edge-tts writes MP3 — we convert to OGG with ffmpeg if available
    const mp3File = path.join(__dirname, '.tts-output.mp3');
    const args = [
      '--voice', VOICE,
      '--file', tmpFile,
      '--write-media', mp3File,
    ];

    execFile('edge-tts', args, { timeout: 30000 }, (err) => {
      // Cleanup temp file
      try { fs.unlinkSync(tmpFile); } catch (_) {}

      if (err) {
        try { fs.unlinkSync(mp3File); } catch (_) {}
        return reject(new Error(`edge-tts failed: ${err.message}`));
      }

      // Try converting to OGG if ffmpeg is available
      try {
        execFile('ffmpeg', [
          '-y', '-i', mp3File,
          '-c:a', 'libopus', '-b:a', '32k', '-ac', '1',
          OUTPUT_FILE,
        ], { timeout: 15000 }, (convErr) => {
          if (convErr) {
            // ffmpeg failed — keep MP3 as fallback
            try { fs.copyFileSync(mp3File, OUTPUT_FILE); } catch (_) {}
          }
          try { fs.unlinkSync(mp3File); } catch (_) {}
          resolve(OUTPUT_FILE);
        });
      } catch (_) {
        // ffmpeg not found — use MP3 as-is (WhatsApp accepts MP3 as voice)
        try { fs.renameSync(mp3File, OUTPUT_FILE); } catch (_) {}
        resolve(OUTPUT_FILE);
      }
    });
  });
}

function isAvailable() {
  return new Promise((resolve) => {
    execFile('edge-tts', ['--version'], { timeout: 5000 }, (err) => {
      resolve(!err);
    });
  });
}

module.exports = { generate, isAvailable };
