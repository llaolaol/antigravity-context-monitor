#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
  Write-Error "Node.js >= 22 is required but was not found in PATH."
}

$NodeMajor = [int](& $NodeCmd.Source -p "process.versions.node.split('.')[0]")
if ($NodeMajor -lt 22) {
  $NodeVer = & $NodeCmd.Source -v
  Write-Error "Node.js >= 22 is required (found $NodeVer)."
}

$InstalledScript = Join-Path $env:USERPROFILE ".gemini\config\plugins\context-monitor\top-capsule.mjs"
if (Test-Path $InstalledScript) {
  $TargetScript = $InstalledScript
} else {
  $TargetScript = Join-Path $PSScriptRoot "top-capsule.mjs"
}

$DataDir = Join-Path $env:USERPROFILE ".gemini\antigravity\sidecar_data\context-monitor\top-capsule"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# Hidden launcher prevents a console window from flashing on Windows login
$VbsPath = Join-Path $DataDir "launch-top-capsule.vbs"
$NodeEsc = $NodeCmd.Source.Replace('"', '""')
$ScriptEsc = $TargetScript.Replace('"', '""')
$VbsContent = "CreateObject(""WScript.Shell"").Run """"""$NodeEsc"""" """"$ScriptEsc"""" "", 0, False"
Set-Content -Path $VbsPath -Value $VbsContent -Encoding ASCII

$TaskName = "AntigravityContextCapsule"
$Action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$VbsPath`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Antigravity Context & Token Monitor top titlebar capsule" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Enabled Windows Scheduled Task: $TaskName (Node: $($NodeCmd.Source), Script: $TargetScript)"
