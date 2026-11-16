param([ValidateSet('ets2','ats','all')][string]$Game='all')
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'data'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
$hashes=@{ets2='f401826998ec96b467a8f280277bb6b5177a7e612d764f87a79b33fa0e3082bb';ats='1fae3af5a6874db02e26d76ad3b4117c2a64bc43c41299d4810bb4cd36f82e67'}
$entries=@{'roadnetwork/graph.bin'='graph.bin';'roadnetwork/geometry.bin'='geometry.bin';'map-data/cities.json'='cities.json';'map-data/tiles/roads.mp3'='roads.pmtiles';'map-data/tiles/map-data-combined.mp3'='details.pmtiles'}
foreach($id in $(if($Game -eq 'all'){@('ets2','ats')}else{@($Game)})) {
    $destination=if($id -eq 'ats'){Join-Path $root 'ats'}else{$root}
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    $missing=@($entries.Values | Where-Object {-not (Test-Path -LiteralPath (Join-Path $destination $_))})
    if($missing.Count -eq 0){Write-Host "$($id.ToUpper()) map is already installed.";continue}
    $archive=Join-Path $destination ('download-'+[Guid]::NewGuid().ToString('N')+'.zip')
    try {
        Write-Host "Downloading $id map from Rares-Muntean/TruckNav-Maps ..."
        Invoke-WebRequest -Uri "https://github.com/Rares-Muntean/TruckNav-Maps/releases/download/map-assets/$id.zip" -OutFile $archive -UseBasicParsing
        if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hashes[$id]){throw 'Upstream archive changed. Nothing was extracted. Update Fura GPS or verify the new source first.'}
        $zip=[IO.Compression.ZipFile]::OpenRead($archive)
        try {
            foreach($name in $entries.Keys){$entry=$zip.GetEntry($name);if(-not $entry -or $entry.Length -le 0){throw "Missing map entry: $name"}}
            foreach($name in $entries.Keys){$target=Join-Path $destination $entries[$name];$staged=$target+'.download';[IO.Compression.ZipFileExtensions]::ExtractToFile($zip.GetEntry($name),$staged,$true);Move-Item -LiteralPath $staged -Destination $target -Force}
        }finally{$zip.Dispose()}
        Write-Host "$($id.ToUpper()) map installed. See THIRD-PARTY-NOTICES.txt for third-party rights." -ForegroundColor Green
    }finally{if(Test-Path -LiteralPath $archive){Remove-Item -LiteralPath $archive -Force}}
}
