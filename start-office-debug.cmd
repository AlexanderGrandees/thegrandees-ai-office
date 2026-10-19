@echo off
rem Starts the server with a visible console (to see errors).
chcp 65001 >nul
title AI Office server
cd /d "%~dp0"
node office-server.mjs
pause
