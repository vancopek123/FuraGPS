$ErrorActionPreference='Stop'
$workspace=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$fixtureRoot=Join-Path $workspace 'installer-tests'
New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
$good=Join-Path $fixtureRoot 'good';$bad=Join-Path $fixtureRoot 'bad'
New-Item -ItemType Directory -Path $good,$bad -Force | Out-Null
foreach($directory in @($good,$bad)){Copy-Item -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'Download-Maps.ps1') -Destination $directory -Force}
$global:FuraGpsQaArchivePath=Join-Path $workspace 'ats-map.zip'
function Invoke-WebRequest {param($Uri,$OutFile,[switch]$UseBasicParsing) Copy-Item -LiteralPath $global:FuraGpsQaArchivePath -Destination $OutFile -Force}
& (Join-Path $good 'Download-Maps.ps1') -Game ats
foreach($name in @('graph.bin','geometry.bin','cities.json','roads.pmtiles','details.pmtiles')){if(-not(Test-Path -LiteralPath (Join-Path $good ('data/ats/'+$name)))){throw 'Missing extracted map'}}
& (Join-Path $good 'Download-Maps.ps1') -Game ats
function Invoke-WebRequest {param($Uri,$OutFile,[switch]$UseBasicParsing) [IO.File]::WriteAllBytes($OutFile,[byte[]]@(1,2,3))}
$rejected=$false;try{& (Join-Path $bad 'Download-Maps.ps1') -Game ats}catch{if($_.Exception.Message -match 'archive changed'){$rejected=$true}else{throw}}
if(-not $rejected -or (Test-Path -LiteralPath (Join-Path $bad 'data/ats/graph.bin'))){throw 'Altered archive was not rejected before extraction'}
$game=Join-Path $fixtureRoot 'fake-ats';New-Item -ItemType Directory -Path (Join-Path $game 'bin/win_x64') -Force | Out-Null;[IO.File]::WriteAllBytes((Join-Path $game 'bin/win_x64/amtrucks.exe'),[byte[]]@(0))
$install=Join-Path $fixtureRoot 'install';New-Item -ItemType Directory -Path (Join-Path $install 'plugin') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) 'Install-Plugin.ps1') -Destination $install -Force
[IO.File]::WriteAllText((Join-Path $install 'plugin/furagps-telemetry.dll'),'test-new-plugin')
function Get-Process {param($Name,$ErrorAction) return $null}
& (Join-Path $install 'Install-Plugin.ps1') -Game ats -GamePath $game
$dll=Join-Path $game 'bin/win_x64/plugins/furagps-telemetry.dll';[IO.File]::WriteAllText($dll,'test-old-plugin')
& (Join-Path $install 'Install-Plugin.ps1') -Game ats -GamePath $game
if([IO.File]::ReadAllText($dll) -ne 'test-new-plugin' -or [IO.File]::ReadAllText($dll+'.backup') -ne 'test-old-plugin'){throw 'Plugin backup or replacement failed'}
Write-Host 'PASS: pinned map extraction, existing-map preservation, changed-archive rejection and plugin install/backup in fake game folders.'
