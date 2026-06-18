# WhatsApp Accounts Notice Scheduler: Suggestions & Alternatives

This document analyzes the current WhatsApp scheduler setup (`index.js`, `start.vbs`, `setup.bat`) and suggests architectural improvements, reliability upgrades, and alternatives for more robust operations on Windows.

---

## 1. Codebase Improvements (Immediate Upgrades)

### A. Environment Configuration & Secrets Management
*   **Current Issue:** The recipient phone number (`target`), schedules, and timezone are hardcoded inside `index.js`.
*   **Improvement:** Use `dotenv` to separate configuration from the execution logic. This prevents accidentally committing private numbers to version control.
*   **Actionable Change:**
    1. Install `dotenv`: `npm install dotenv`
    2. Create a `.env` file:
       ```env
       TARGET_NUMBER=8801XXXXXXXXX@c.us
       TIMEZONE=Asia/Dhaka
       MORNING_TEXT_CRON=30 9 * * *
       MORNING_VOICE_CRON=0 10 * * *
       AFTERNOON_TEXT_CRON=0 14 * * *
       AFTERNOON_VOICE_CRON=30 14 * * *
       ```
    3. Load configuration via `process.env` in `index.js`.

### B. Auto-Audio Conversion (Built-in FFmpeg wrapper)
*   **Current Issue:** The user has to manually convert audio files to OGG/Opus format via Command Line.
*   **Improvement:** Integrate automatic conversion inside `index.js` using `fluent-ffmpeg` or a simple child process execution. If the user drops a `voice.mp3` or `voice.wav` in the folder, the script automatically converts it to `voice.ogg` using the correct Opus codec.
*   **Example Code:**
    ```javascript
    const { exec } = require('child_process');
    function convertToOggOpus(inputFile, outputFile) {
      return new Promise((resolve, reject) => {
        exec(`ffmpeg -y -i "${inputFile}" -c:a libopus -b:a 32k -ac 1 "${outputFile}"`, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    ```

### C. Robust Crash Recovery & Reconnection
*   **Current Issue:** `client.on('disconnected')` simply waits 10 seconds and calls `client.initialize()`. This can cause recursive initialization loops or fail if the Puppeteer process itself hung or crashed.
*   **Improvement:** Implement a proper restart function that destroys the existing client instance completely before creating a new one:
    ```javascript
    client.on('disconnected', async (reason) => {
      log(`⚠️ Disconnected: ${reason}. Cleaning up client...`);
      try {
        await client.destroy();
      } catch (e) {
        log(`Error destroying client: ${e.message}`);
      }
      log('Re-initializing client in 10s...');
      setTimeout(() => client.initialize(), 10000);
    });
    ```

### D. Silent Failure Notifications
*   **Current Issue:** Since the script runs silently via `start.vbs`, if the WhatsApp session expires and needs a QR scan, the user won't know unless they check `scheduler.log`.
*   **Improvement:** Set up a quick Telegram Bot or Discord Webhook notification. If authentication fails or a QR is generated, the script sends the notification to the user's phone, keeping them updated without opening files.

---

## 2. Process Management Alternatives on Windows

While `start.vbs` is lightweight, it is difficult to monitor, has no automatic recovery on crash, and must be manually killed via Task Manager.

### Option A: PM2 (Node.js Process Manager) - *Recommended for Node.js developers*
PM2 runs Node scripts as background daemons, logs output to centralized files, and restarts scripts if they crash.
*   **Startup Configuration:**
    1. Install PM2 and the Windows startup manager:
       ```bash
       npm install -g pm2
       npm install -g pm2-windows-startup
       ```
    2. Start the script: `pm2 start index.js --name "hishab-bot"`
    3. Freeze startup script: `pm2-startup` followed by `pm2 save`

### Option B: Windows Service Integration (NSSM or `node-windows`)
Convert the script into a standard Windows Service that starts automatically before user login.
*   **Implementation:** Use the `node-windows` package.
*   **Setup Script (`install-service.js`):**
    ```javascript
    const Service = require('node-windows').Service;
    const svc = new Service({
      name: 'WhatsApp Accounts Scheduler',
      description: 'Sends daily accounts notifications on WhatsApp.',
      script: require('path').join(__dirname, 'index.js')
    });
    svc.on('install', () => svc.start());
    svc.install();
    ```

---

## 3. Alternative WhatsApp Automation Engines

`whatsapp-web.js` is an unofficial library that acts as a wrapper around Puppeteer. While popular, it is highly sensitive to changes in WhatsApp Web and has a relatively high RAM footprint.

### 1. Baileys (Direct Socket Connection)
*   **How it works:** Directly implements the WhatsApp Web WebSocket protocol without launching a headless browser (no Puppeteer/Chromium).
*   **Pros:**
    *   **Extremely lightweight:** Uses less than 50MB of RAM (vs 200MB+ for Puppeteer).
    *   Faster initialization and less prone to memory leaks.
*   **Cons:** Requires manual raw message formatting and is occasionally more complex to maintain when WhatsApp updates its protobuf schemas.

### 2. WAHA (WhatsApp HTTP API) - *Highly Recommended*
A ready-to-use self-hosted API gateway for WhatsApp. Since it runs in a Docker container, it encapsulates all dependencies.
*   **Pros:**
    *   Provides standard REST API endpoints (e.g. `POST /api/sendText`, `POST /api/sendVoice`).
    *   Handles reconnections, session storage, and multiple engines (Web/Puppeteer, Baileys, Core) under the hood.
    *   Includes a built-in web UI to scan QR codes and monitor session status.
*   **Cons:** Requires Docker to be installed on Windows.

### 3. Official WhatsApp Business Cloud API
*   **How it works:** The official API provided by Meta.
*   **Pros:**
    *   100% reliable, zero ban risk, official support.
    *   No local server/browser required to stay online.
*   **Cons:**
    *   Requires a Meta Business Manager account.
    *   Messages must be pre-approved Templates to initiate conversations.
    *   Costs money per conversation (though there is a free tier of 1,000 monthly conversations).
