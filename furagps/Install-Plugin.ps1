param([ValidateSet('ets2','ats','all')][string]$Game='all',[string]$GamePath)
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot 'plugin\furagps-telemetry.dll'
if(-not(Test-Path -LiteralPath $source)){throw 'Plugin missing from package.'}
$steam=(Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
$libraries=@($steam)
if($steam){$vdf=Join-Path $steam 'steamapps\libraryfolders.vdf';if(Test-Path -LiteralPath $vdf){foreach($m in [regex]::Matches((Get-Content -LiteralPath $vdf -Raw),'"path"\s*"([^"]+)"')){$libraries+=$m.Groups[1].Value.Replace('\\','\')}}}
foreach($drive in Get-PSDrive -PSProvider FileSystem){$libraries+=Join-Path $drive.Root 'SteamLibrary';$libraries+=Join-Path $drive.Root 'Steam'}
$targets=@()
foreach($id in $(if($Game -eq 'all'){@('ets2','ats')}else{@($Game)})) {
    $folder=if($id -eq 'ats'){'American Truck Simulator'}else{'Euro Truck Simulator 2'}
    $process=if($id -eq 'ats'){'amtrucks'}else{'eurotrucks2'}
    $candidates=@();if($GamePath){$candidates+=$GamePath};$candidates+=@($libraries | Where-Object {$_} | Select-Object -Unique | ForEach-Object {Join-Path $_ ('steamapps\common\'+$folder)})
    $path=$candidates | Where-Object {Test-Path -LiteralPath (Join-Path $_ ('bin\win_x64\'+$process+'.exe'))} | Select-Object -First 1
    if(-not $path -and $Game -ne 'all'){$path=Read-Host "Enter your $folder installation folder";if(-not(Test-Path -LiteralPath (Join-Path $path ('bin\win_x64\'+$process+'.exe')))){throw 'The selected folder does not contain the game.'}}
    if($path){if(Get-Process -Name $process -ErrorAction SilentlyContinue){throw "Close $folder before installing the new plugin."};$targets+=@{Id=$id;Path=$path}}
}
if($targets.Count -eq 0){throw 'No game installation found. Run with -Game ets2 or -Game ats and -GamePath YOUR_GAME_FOLDER.'}
foreach($target in $targets){$directory=Join-Path $target.Path 'bin\win_x64\plugins';New-Item -ItemType Directory -Path $directory -Force | Out-Null;$file=Join-Path $directory 'furagps-telemetry.dll';if(Test-Path -LiteralPath $file){Copy-Item -LiteralPath $file -Destination ($file+'.backup') -Force};Copy-Item -LiteralPath $source -Destination $file -Force;Write-Host "Installed $($target.Id): $file" -ForegroundColor Green}
Write-Host 'Start FuraGPS.exe, then the game. Accept the SDK plugin prompt.'
