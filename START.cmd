@echo off
rem Double-click to open the launcher homepage (http://127.0.0.1:8080).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js is required. Install the LTS version from https://nodejs.org and run this file again.
 pause
 exit /b 1
)
echo Launcher: http://127.0.0.1:8080  - close this window to stop everything.
node launcher/server.js --open
pause
