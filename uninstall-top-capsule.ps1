#Requires -Version 5.1
$ErrorActionPreference = "SilentlyContinue"

$TaskName = "AntigravityContextCapsule"
Stop-ScheduledTask -TaskName $TaskName
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like "*top-capsule.mjs*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

$VbsPath = Join-Path $env:USERPROFILE ".gemini\antigravity\sidecar_data\context-monitor\top-capsule\launch-top-capsule.vbs"
if (Test-Path $VbsPath) {
  Remove-Item -Path $VbsPath -Force
}

Write-Host "Disabled and removed Scheduled Task: $TaskName"
