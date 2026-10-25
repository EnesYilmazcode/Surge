@echo off
title Surge local editor
cd /d "%~dp0"
echo Surge editor: http://127.0.0.1:5173/app.html
echo AI chat uses the Claude Code CLI signed in on this computer.
echo Close this window to stop the server.
echo.
call npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
pause
