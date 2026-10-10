@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [!] Node.js not found.
  echo       Install it from https://nodejs.org/ then run this file again.
  echo.
  pause
  exit /b 1
)
echo.
echo   Starting local server for "My Class Schedule" ...
node tools\serve.mjs %1
echo.
echo   Server stopped.
pause
