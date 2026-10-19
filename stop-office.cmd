@echo off
rem Stops the background office server.
powershell -NoProfile -WindowStyle Hidden -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*office-server.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
