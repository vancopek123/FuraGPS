$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot 'FuraGPS.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'FuraGPS.exe was not found in this folder. Extract the complete Windows ZIP first.' }
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'))
    exit
}
$ruleName = 'FuraGPS-Private-LAN'
Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -Name $ruleName -DisplayName 'Fura GPS - private local network' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 28888 -Program $exe -Profile Private -RemoteAddress LocalSubnet | Out-Null
Get-NetFirewallRule -Name 'FuraGPS-Discovery-LAN' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -Name 'FuraGPS-Discovery-LAN' -DisplayName 'Fura GPS - LAN discovery' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 28890 -Program $exe -Profile Private -RemoteAddress LocalSubnet | Out-Null
Write-Host 'Fura GPS is allowed on your private local network. HTTP: TCP 28888; PC discovery: UDP 28890.' -ForegroundColor Green
