@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Please install it from https://nodejs.org and try again.
  pause
  exit /b
)
if not exist node_modules (
  echo Installing, please wait...
  call npm install
)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node server.js
pause
