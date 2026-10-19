@echo off
rem Adds the office server to Windows startup (run with --remove to undo).
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AI Office server.lnk"
if /i "%~1"=="--remove" ( del "%LNK%" 2>nul & echo Autostart removed. & pause & exit /b )
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0start-office-hidden.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.Save()"
echo Autostart added: the server will start hidden after Windows sign-in.
pause
