# TGTI AI Office: quiet update. Downloads the newest installer from GitHub and runs it; everything goes to update.log.
$App = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $App 'update.log'
"$(Get-Date -Format s) update started" | Out-File -Append -Encoding utf8 $log
try {
  $s = Invoke-RestMethod -UseBasicParsing 'https://raw.githubusercontent.com/AlexanderGrandees/thegrandees-ai-office/main/windows/install.ps1'
  & ([scriptblock]::Create($s)) *>&1 | Out-File -Append -Encoding utf8 $log
} catch { $_ | Out-File -Append -Encoding utf8 $log }
"$(Get-Date -Format s) update finished" | Out-File -Append -Encoding utf8 $log
