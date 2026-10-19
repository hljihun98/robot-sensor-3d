@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js 24 LTS is required. Install it and run this file again.
 pause
 exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<24) process.exit(1)"
if errorlevel 1 (
 echo Node.js 24 or newer is required.
 pause
 exit /b 1
)
if not exist "node_modules\express" (
 call npm.cmd ci --omit=dev --no-audit --no-fund
 if errorlevel 1 (
  pause
  exit /b 1
 )
)
echo Open http://127.0.0.1:3210 in your browser.
echo First account: data\initial-account.txt (created on first start).
node server/app.js
pause
