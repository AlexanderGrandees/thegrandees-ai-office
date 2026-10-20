@echo off
rem TGTI AI Office: double-click to install on Windows (same as the one-line PowerShell command, but from this folder).
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:TGTI_SOURCE='%~dp0.'; & '%~dp0windows\install.ps1'"
pause
