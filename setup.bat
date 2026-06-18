@echo off
echo ============================================
echo   WhatsApp Accounts Scheduler — Setup
echo   Packages: whatsapp-web.js 1.34.7
echo             node-cron 4.3.0
echo             dotenv
echo ============================================
echo.

echo Checking Node.js version (must be v18 or higher)...
node --version
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js not found. Download from https://nodejs.org
    pause
    exit /b 1
)
echo.

echo Initialising npm project...
call npm init -y
echo.

echo Installing packages...
call npm install whatsapp-web.js@1.34.7 qrcode-terminal node-cron@4.3.0 dotenv
echo.

echo Creating config from template...
if not exist .env (
    copy .env.example .env
    echo Created .env — edit with your settings.
) else (
    echo .env already exists — skipping.
)
echo.

echo Creating folders...
if not exist messages mkdir messages
echo.

echo ============================================
echo   Setup complete! Next steps:
echo.
echo   1. Edit .env
echo      Set TARGET_PHONE to the recipient's
echo      number (e.g. 8801712345678@c.us)
echo.
echo   2. Edit messages/*.txt
echo      Customize the Bengali messages.
echo      Use {yesterday}, {today}, {tomorrow}
echo      placeholders if needed.
echo.
echo   3. Prepare voice.ogg
echo      Must be OGG/Opus format. Convert with:
echo      ffmpeg -i input.mp3 -c:a libopus -b:a 32k -ac 1 voice.ogg
echo.
echo   4. First run (QR scan):
echo      node index.js
echo      Scan the QR in WhatsApp → Linked Devices
echo      Wait for "Client ready", then Ctrl+C
echo.
echo   5. Background (daily use):
echo      Double-click start.vbs  (no window)
echo      OR add a shortcut to start.vbs in:
echo      shell:startup  (runs on every boot)
echo ============================================
echo.
pause
