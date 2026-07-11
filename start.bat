@echo off
REM Khoi dong backend tren Windows (cmd.exe).
cd /d "%~dp0"

if not exist node_modules (
  echo Dang cai dependencies...
  call npm install --omit=dev
)

if "%PORT%"=="" set PORT=3000
if "%HOST%"=="" set HOST=0.0.0.0
echo Khoi dong Map-Share tai http://%HOST%:%PORT%
node server.js
