param([string]$JavaHome=$env:JAVA_HOME,[string]$AndroidSdk=$env:ANDROID_SDK_ROOT)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $AndroidSdk) { $AndroidSdk=if($env:ANDROID_HOME){$env:ANDROID_HOME}else{Join-Path $env:LOCALAPPDATA 'Android\Sdk'} }
if (-not $JavaHome) { $javac=Get-Command javac.exe -ErrorAction SilentlyContinue; $JavaHome=if($javac){Split-Path (Split-Path $javac.Source)}else{Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'} }
$javaDir = Join-Path $JavaHome 'bin'
$sdk = $AndroidSdk
$toolsDir = Join-Path $sdk 'build-tools\36.0.0'
$androidJar = Join-Path $sdk 'platforms\android-36\android.jar'
$env:JAVA_HOME = Split-Path $javaDir
$env:Path = "$javaDir;$env:Path"
$buildDir = Join-Path $root 'build\android'
New-Item -ItemType Directory -Path $buildDir,(Join-Path $buildDir 'classes'),(Join-Path $buildDir 'dex'),(Join-Path $buildDir 'generated'),(Join-Path $buildDir 'assets') -Force | Out-Null
Copy-Item -LiteralPath "$root\server\wwwroot\hud-layout.css","$root\server\wwwroot\hud-layout.js" -Destination (Join-Path $buildDir 'assets') -Force
foreach ($name in @('connection.html','connection.css','connection.js','i18n.js','translations.js')) { Copy-Item -LiteralPath (Join-Path $root "server/wwwroot/$name") -Destination (Join-Path $buildDir 'assets') -Force }
& node (Join-Path $root 'tools/export-translations.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Translation export failed.' }
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw "Build step failed: $LASTEXITCODE" } }
& "$toolsDir\aapt2.exe" compile --dir "$root\android\res" -o "$buildDir\resources.zip"
Check-Exit
& "$toolsDir\aapt2.exe" link -o "$buildDir\unsigned.apk" -I $androidJar --manifest "$root\android\AndroidManifest.xml" --java "$buildDir\generated" -A "$buildDir\assets" "$buildDir\resources.zip"
Check-Exit
& "$javaDir\javac.exe" -encoding UTF-8 --release 8 -classpath $androidJar -d "$buildDir\classes" "$root\android\src\si\furagps\app\MainActivity.java"
Check-Exit
& "$javaDir\jar.exe" cf "$buildDir\classes.jar" -C "$buildDir\classes" .
Check-Exit
& "$javaDir\java.exe" -cp "$toolsDir\lib\d8.jar" com.android.tools.r8.D8 --lib $androidJar --min-api 26 --output "$buildDir\dex" "$buildDir\classes.jar"
Check-Exit
& "$javaDir\jar.exe" uf "$buildDir\unsigned.apk" -C "$buildDir\dex" classes.dex
Check-Exit
& "$toolsDir\zipalign.exe" -f -p 4 "$buildDir\unsigned.apk" "$buildDir\aligned.apk"
Check-Exit
$keystore = Join-Path $root 'build\furagps-local.jks'
if ($env:FURAGPS_KEYSTORE_FILE) { $keystore=$env:FURAGPS_KEYSTORE_FILE }
$alias=if($env:FURAGPS_KEY_ALIAS){$env:FURAGPS_KEY_ALIAS}else{'furagps'}
function Read-SigningSecret([string]$Prompt) {
    $secret=Read-Host $Prompt -AsSecureString
    $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose() }
}
$previousStorePassword=$env:FURAGPS_KEYSTORE_PASSWORD
$previousKeyPassword=$env:FURAGPS_KEY_PASSWORD
try {
    if (-not $env:FURAGPS_KEYSTORE_PASSWORD) { $env:FURAGPS_KEYSTORE_PASSWORD=Read-SigningSecret 'APK keystore password (not saved)' }
    if (-not $env:FURAGPS_KEY_PASSWORD) { $env:FURAGPS_KEY_PASSWORD=$env:FURAGPS_KEYSTORE_PASSWORD }
    if (-not (Test-Path -LiteralPath $keystore)) {
        & "$javaDir\keytool.exe" -genkeypair -keystore $keystore -storepass:env FURAGPS_KEYSTORE_PASSWORD -keypass:env FURAGPS_KEY_PASSWORD -alias $alias -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Fura GPS Local Build,O=Fura GPS,C=SI'
        Check-Exit
    }
    & "$javaDir\java.exe" -jar "$toolsDir\lib\apksigner.jar" sign --ks $keystore --ks-key-alias $alias --ks-pass env:FURAGPS_KEYSTORE_PASSWORD --key-pass env:FURAGPS_KEY_PASSWORD --out "$root\build\FuraGPS.apk" "$buildDir\aligned.apk"
    Check-Exit
    & "$javaDir\java.exe" -jar "$toolsDir\lib\apksigner.jar" verify --verbose "$root\build\FuraGPS.apk"
    Check-Exit
} finally {
    $env:FURAGPS_KEYSTORE_PASSWORD=$previousStorePassword
    $env:FURAGPS_KEY_PASSWORD=$previousKeyPassword
}
