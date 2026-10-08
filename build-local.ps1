param(
    [string]$SdkRoot = "$env:LOCALAPPDATA\Android\Sdk",
    [string]$JavaHome = 'C:\Program Files\Android\Android Studio\jbr',
    [string]$BuildToolsVersion = '36.0.0',
    [string]$Platform = 'android-36'
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$out = Join-Path $root 'build\local'
$sourceRoot = Join-Path $root 'app\src\main'
$bt = Join-Path $SdkRoot "build-tools\$BuildToolsVersion"
$androidJar = Join-Path $SdkRoot "platforms\$Platform\android.jar"
$java = Join-Path $JavaHome 'bin\java.exe'
$javac = Join-Path $JavaHome 'bin\javac.exe'
$jar = Join-Path $JavaHome 'bin\jar.exe'
$keytool = Join-Path $JavaHome 'bin\keytool.exe'
foreach ($file in @($androidJar,$java,$javac,$jar,$keytool,(Join-Path $bt 'aapt2.exe'))) {
    if (!(Test-Path -LiteralPath $file)) { throw "Required Android build tool not found: $file" }
}
foreach ($folder in @($out,(Join-Path $out 'gen'),(Join-Path $out 'compiled-res'),(Join-Path $out 'packaged'),(Join-Path $out 'classes'),(Join-Path $out 'dex'))) { New-Item -ItemType Directory -Force -Path $folder | Out-Null }
New-Item -ItemType Directory -Force -Path (Join-Path $out 'packaged\res\drawable'),(Join-Path $out 'packaged\assets') | Out-Null
function Check-Exit([string]$Step) { if ($LASTEXITCODE -ne 0) { throw "$Step failed ($LASTEXITCODE)" } }
$manifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'AndroidManifest.xml') -Encoding UTF8 -Raw
if ($manifest -notmatch 'package="cn.goldsense.app"') { $manifest=$manifest.Replace('<manifest ', '<manifest package="cn.goldsense.app" ') }
[IO.File]::WriteAllText((Join-Path $out 'AndroidManifest.xml'), $manifest, [Text.UTF8Encoding]::new($false))
& (Join-Path $bt 'aapt2.exe') compile --dir (Join-Path $sourceRoot 'res') -o (Join-Path $out 'compiled-res')
Check-Exit 'Resource compilation'
$compiled = @((Get-ChildItem -LiteralPath (Join-Path $out 'compiled-res') -Filter '*.flat').FullName)
& (Join-Path $bt 'aapt2.exe') link --output-to-dir -o (Join-Path $out 'packaged') --manifest (Join-Path $out 'AndroidManifest.xml') -I $androidJar --java (Join-Path $out 'gen') --min-sdk-version 26 --target-sdk-version 36 -A (Join-Path $sourceRoot 'assets') @compiled
Check-Exit 'Resource linking'
# Use the JDK archive writer; the local AAPT ZIP writer crashes on archive finalization.
# Store resources uncompressed, then align and sign with the Android SDK tools.
& $jar "-J-Djava.io.tmpdir=$out" cf0 (Join-Path $out 'unsigned.apk') -C (Join-Path $out 'packaged') .
Check-Exit 'Resource packaging'
$sources = @((Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'java') -Recurse -Filter '*.java').FullName) + @((Get-ChildItem -LiteralPath (Join-Path $out 'gen') -Recurse -Filter '*.java').FullName)
& $javac -encoding UTF-8 -source 17 -target 17 -classpath $androidJar -d (Join-Path $out 'classes') @sources
Check-Exit 'Java compilation'
& $jar "-J-Djava.io.tmpdir=$out" cf (Join-Path $out 'classes.jar') -C (Join-Path $out 'classes') .
Check-Exit 'Class packaging'
& $java -cp (Join-Path $bt 'lib\d8.jar') com.android.tools.r8.D8 --release --min-api 26 --lib $androidJar --output (Join-Path $out 'dex') (Join-Path $out 'classes.jar')
Check-Exit 'DEX compilation'
& $jar "-J-Djava.io.tmpdir=$out" uf (Join-Path $out 'unsigned.apk') -C (Join-Path $out 'dex') classes.dex
Check-Exit 'DEX packaging'
& python (Join-Path $root 'align-apk.py') (Join-Path $out 'unsigned.apk') (Join-Path $out 'aligned.apk')
Check-Exit 'APK alignment'
& (Join-Path $bt 'zipalign.exe') -c 4 (Join-Path $out 'aligned.apk')
Check-Exit 'Android SDK alignment verification'
$key = Join-Path $out 'local-development.keystore'
if (!(Test-Path -LiteralPath $key)) {
    & $keytool -genkeypair -keystore $key -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=GoldSentAnalysis Local Development,O=Personal,C=CN'
    Check-Exit 'Development signing key'
}
$apk = Join-Path $root 'GoldSense-1.3.0.apk'
& $java -jar (Join-Path $bt 'lib\apksigner.jar') sign --ks $key --ks-pass pass:android --key-pass pass:android --out $apk (Join-Path $out 'aligned.apk')
Check-Exit 'APK signing'
& $java -jar (Join-Path $bt 'lib\apksigner.jar') verify --verbose $apk
Check-Exit 'APK verification'
Write-Output "Built and verified: $apk"
