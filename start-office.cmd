@echo off
rem Starts the office server in the background, no console window.
cd /d "%~dp0"
start "" wscript.exe "%~dp0start-office-hidden.vbs"
