# TGTI AI Office: removes everything the Windows installer added.
#   powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\TGTI-AI-Office\uninstall.ps1"
$ErrorActionPreference = 'Continue'
$App = Join-Path $env:LOCALAPPDATA 'TGTI-AI-Office'
Write-Host "`nTGTI AI Office: removing" -ForegroundColor Magenta
Unregister-ScheduledTask -TaskName 'TGTI AI Office' -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*office-server.mjs*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$node = 'node'
if (Test-Path "$App\node-path.txt") { $node = (Get-Content "$App\node-path.txt" -Encoding Unicode | Select-Object -First 1).Trim() }
if (Test-Path "$App\install-hooks.mjs") { Push-Location $App; & $node install-hooks.mjs --remove; Pop-Location }
if (Test-Path "$App\we-path.txt") {
  $wall = (Get-Content "$App\we-path.txt" -Encoding Unicode | Select-Object -First 1).Trim()
  if ($wall -like '*tgti-ai-office') { Remove-Item $wall -Recurse -Force -ErrorAction SilentlyContinue }
}
Set-Location $env:TEMP
Remove-Item $App -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'Done: task, server, hooks, wallpaper and files are removed.' -ForegroundColor Green
