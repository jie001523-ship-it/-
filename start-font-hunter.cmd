@echo off
setlocal
cd /d "%~dp0"
echo Starting Font Hunter...
echo.
start "" cmd /c "timeout /t 3 /nobreak >nul && start "" http://localhost:4173"
npm start
echo.
echo Font Hunter stopped. Press any key to close this window.
pause >nul
