<#
.SYNOPSIS
    把 apk/ 里的壳源码构建成 out/ChOIceN.apk。

.DESCRIPTION
    不依赖 Gradle、Android Studio 图形界面，也不下载任何依赖 —— 直接串起本机 SDK 自带的
    命令行工具：

        aapt2 compile → aapt2 link → javac → d8 → 塞入 classes.dex → zipalign → apksigner

    版本号、minSdk、targetSdk 全部从 AndroidManifest.xml 读取，避免两处不一致。

.PARAMETER SkipSign
    只构建不签名，产出 apk/build/aligned.apk（用来排查构建问题）。

.EXAMPLE
    pwsh -File apk\build.ps1
#>
[CmdletBinding()]
param(
    [string]$SdkRoot     = 'D:\AndroidStudio\SDK',
    [string]$BuildTools  = '36.0.0',
    [string]$Platform    = 'android-37.0',
    [string]$JdkHome     = 'C:\Program Files\Zulu\zulu-21',
    [string]$KeystoreDir = (Join-Path $env:USERPROFILE '.android\choice-keystore'),
    [switch]$SkipSign
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Invoke-Tool {
    param([string]$Exe, [string[]]$ToolArgs, [string]$Label)
    Write-Host "    $Label" -ForegroundColor DarkGray
    & $Exe @ToolArgs
    if ($LASTEXITCODE -ne 0) {
        throw "$Label 失败（exit $LASTEXITCODE）：$Exe"
    }
}

function Get-ToolVersion {
    param([string]$Exe, [string[]]$ToolArgs)
    try { return ((& $Exe @ToolArgs 2>&1 | Out-String).Trim() -split "`r?`n")[0] }
    catch { return '(未知)' }
}

# ---------------------------------------------------------------- 路径与前置检查

$ApkDir   = $PSScriptRoot
$RepoRoot = Split-Path -Path $ApkDir -Parent
$BuildDir = Join-Path $ApkDir 'build'
$OutDir   = Join-Path $RepoRoot 'out'

$Manifest   = Join-Path $ApkDir 'AndroidManifest.xml'
$ResDir     = Join-Path $ApkDir 'res'
$SrcDir     = Join-Path $ApkDir 'src'
$AndroidJar = Join-Path $SdkRoot "platforms\$Platform\android.jar"
$BT         = Join-Path $SdkRoot "build-tools\$BuildTools"

$tools = @{
    'aapt2'     = Join-Path $BT 'aapt2.exe'
    'zipalign'  = Join-Path $BT 'zipalign.exe'
    'd8'        = Join-Path $BT 'd8.bat'
    'apksigner' = Join-Path $BT 'apksigner.bat'
    'javac'     = Join-Path $JdkHome 'bin\javac.exe'
}
foreach ($kv in $tools.GetEnumerator()) {
    if (-not (Test-Path -LiteralPath $kv.Value)) {
        throw "缺少工具 $($kv.Key)：$($kv.Value)"
    }
}
if (-not (Test-Path -LiteralPath $AndroidJar)) {
    throw "缺少 android.jar：$AndroidJar（可用 -Platform android-28 回退）"
}

# 版本信息以 AndroidManifest.xml 为唯一来源
$manifestText = Get-Content -LiteralPath $Manifest -Raw
function Get-ManifestValue([string]$Pattern, [string]$What) {
    if ($manifestText -match $Pattern) { return $Matches[1] }
    throw "AndroidManifest.xml 里读不到 $What"
}
$VersionCode = Get-ManifestValue 'android:versionCode="(\d+)"'          'versionCode'
$VersionName = Get-ManifestValue 'android:versionName="([^"]+)"'        'versionName'
$MinSdk      = Get-ManifestValue 'android:minSdkVersion="(\d+)"'        'minSdkVersion'
$TargetSdk   = Get-ManifestValue 'android:targetSdkVersion="(\d+)"'     'targetSdkVersion'
$PackageName = Get-ManifestValue 'package="([^"]+)"'                    'package'

Write-Host "ChOIceN 手机壳构建" -ForegroundColor White
Write-Host "  包名      $PackageName"
Write-Host "  版本      $VersionName ($VersionCode)"
Write-Host "  SDK       min $MinSdk / target $TargetSdk / 编译用 $Platform"
Write-Host "  源码      $ApkDir"
Write-Host "  产物      $OutDir"

# ---------------------------------------------------------------- 清理

if (Test-Path -LiteralPath $BuildDir) {
    $resolved = (Resolve-Path -LiteralPath $BuildDir).Path
    if ($resolved -ne (Join-Path $ApkDir 'build')) {
        throw "拒绝清理，路径不像构建目录：$resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
foreach ($d in 'res', 'classes', 'dex', 'gen') {
    New-Item -ItemType Directory -Force -Path (Join-Path $BuildDir $d) | Out-Null
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# ---------------------------------------------------------------- 1. 编译资源

Write-Step "1/6  aapt2 compile：把 res/ 编译成二进制资源"
$resZip = Join-Path $BuildDir 'res.zip'
Invoke-Tool $tools['aapt2'] @('compile', '--dir', $ResDir, '-o', $resZip) 'aapt2 compile'

# ---------------------------------------------------------------- 2. 链接资源

Write-Step "2/6  aapt2 link：生成资源表与 APK 骨架（含 R.java）"
$baseApk = Join-Path $BuildDir 'base.apk'
$genDir  = Join-Path $BuildDir 'gen'
Invoke-Tool $tools['aapt2'] @(
    'link',
    '-o', $baseApk,
    '-I', $AndroidJar,
    '--manifest', $Manifest,
    $resZip,
    '--java', $genDir,
    '--min-sdk-version', $MinSdk,
    '--target-sdk-version', $TargetSdk,
    '--version-code', $VersionCode,
    '--version-name', $VersionName
) 'aapt2 link'

# ---------------------------------------------------------------- 3. 编译 Java

Write-Step "3/6  javac：编译 MainActivity.java"
$classDir = Join-Path $BuildDir 'classes'
$sources  = @(Get-ChildItem -LiteralPath $SrcDir -Recurse -Filter *.java -File)
$sources += @(Get-ChildItem -LiteralPath $genDir -Recurse -Filter *.java -File)
if ($sources.Count -eq 0) { throw "在 $SrcDir 里没找到任何 .java" }

# 语言级别固定 8：javac 9+ 因为模块系统禁止 -bootclasspath 与 source >= 9 同时使用，
# 而手工构建必须把 android.jar 当引导类路径，否则会误用 JDK 自己的 java.* 实现。
# 我们的代码没有用到 Java 9+ 语法，所以 8 完全够用。d8 也吃 Java 8 字节码。
$javacArgs = @(
    '-encoding', 'UTF-8',
    '-Xlint:-options',
    '-source', '8',
    '-target', '8',
    '-bootclasspath', $AndroidJar,
    '-d', $classDir
)
# 逐个追加，别写成嵌套数组 —— [string[]] 会把子数组拼成一个参数
$javacArgs += [string[]]($sources | ForEach-Object { $_.FullName })
Invoke-Tool $tools['javac'] $javacArgs "javac（$($sources.Count) 个源文件）"

# ---------------------------------------------------------------- 4. dex + 组装

Write-Step "4/6  d8：把 class 转成 classes.dex，并放进 APK"
$classesJar = Join-Path $BuildDir 'classes.jar'
& (Join-Path $JdkHome 'bin\jar.exe') cf $classesJar -C $classDir .
if ($LASTEXITCODE -ne 0) { throw "jar 打包 class 失败（exit $LASTEXITCODE）" }

$dexDir = Join-Path $BuildDir 'dex'
Invoke-Tool $tools['d8'] @(
    '--release',
    '--min-api', $MinSdk,
    '--lib', $AndroidJar,
    '--output', $dexDir,
    $classesJar
) 'd8'

$unsigned = Join-Path $BuildDir 'unsigned.apk'
Copy-Item -LiteralPath $baseApk -Destination $unsigned -Force

# 用 .NET 的 ZipArchive 而不是 jar：jar 会顺手塞一个多余的 META-INF/MANIFEST.MF。
Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
$dexBytes = [System.IO.File]::ReadAllBytes((Join-Path $dexDir 'classes.dex'))
$zip = [System.IO.Compression.ZipFile]::Open($unsigned, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    $entry = $zip.CreateEntry('classes.dex', [System.IO.Compression.CompressionLevel]::NoCompression)
    $stream = $entry.Open()
    try { $stream.Write($dexBytes, 0, $dexBytes.Length) } finally { $stream.Dispose() }
} finally {
    $zip.Dispose()
}

$entryNames = ([System.IO.Compression.ZipFile]::OpenRead($unsigned)).Entries | ForEach-Object { $_.FullName }
if ($entryNames -notcontains 'classes.dex') { throw "classes.dex 没有成功放进 APK" }

# ---------------------------------------------------------------- 5. 对齐

Write-Step "5/6  zipalign：4 字节对齐（必须在签名之前）"
$aligned = Join-Path $BuildDir 'aligned.apk'
Invoke-Tool $tools['zipalign'] @('-f', '4', $unsigned, $aligned) 'zipalign'

if ($SkipSign) {
    Write-Host ""
    Write-Host "已跳过签名，产出：$aligned" -ForegroundColor Yellow
    exit 0
}

# ---------------------------------------------------------------- 6. 签名

Write-Step "6/6  apksigner：用自用 release 钥匙签名（v2+v3）"
$propsPath = Join-Path $KeystoreDir 'keystore.properties'
if (-not (Test-Path -LiteralPath $propsPath)) {
    throw @"
找不到签名配置：$propsPath
请先执行一次：pwsh -File "$ApkDir\make-keystore.ps1"
（会用 -KeystoreDir 指定别的目录也行）
"@
}

$props = @{}
foreach ($line in (Get-Content -LiteralPath $propsPath)) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $props[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim()
}
foreach ($k in 'storeFile', 'storePassword', 'keyAlias', 'keyPassword') {
    if (-not $props.ContainsKey($k)) { throw "keystore.properties 里缺少 $k" }
}
$storeFile = $props['storeFile']
if (-not [System.IO.Path]::IsPathRooted($storeFile)) {
    $storeFile = Join-Path $KeystoreDir $storeFile
}
if (-not (Test-Path -LiteralPath $storeFile)) { throw "找不到钥匙文件：$storeFile" }

# minSdk 24 = Android 7.0，平台从 API 24 起就支持 APK Signature Scheme v2，
# 所以不需要 v1（JAR 签名）—— AGP 在 minSdk >= 24 时也是这么做的，能少 3 个文件。
$finalApk = Join-Path $OutDir 'ChOIceN.apk'

# 清掉上一轮的产物，否则会留下过期的 .idsig
Get-ChildItem -LiteralPath $OutDir -Filter 'ChOIceN.apk*' -File -ErrorAction SilentlyContinue |
    Remove-Item -Force

Invoke-Tool $tools['apksigner'] @(
    'sign',
    '--ks', $storeFile,
    '--ks-key-alias', $props['keyAlias'],
    '--ks-pass', "pass:$($props['storePassword'])",
    '--key-pass', "pass:$($props['keyPassword'])",
    '--v1-signing-enabled', 'false',
    '--v2-signing-enabled', 'true',
    '--v3-signing-enabled', 'true',
    '--v4-signing-enabled', 'false',
    '--out', $finalApk,
    $aligned
) 'apksigner sign'

# ---------------------------------------------------------------- 校验与产物信息

Write-Step "校验"
$verify = & $tools['apksigner'] verify --print-certs --verbose $finalApk 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "apksigner verify 失败：`n$verify" }
$verify | Write-Host

$badging = & $tools['aapt2'] dump badging $finalApk 2>&1 | Out-String
$permissions = ($badging -split "`r?`n" | Where-Object { $_ -like 'uses-permission*' }) -join "`n"
if (-not $permissions) { $permissions = '(无)' }

$apkInfo  = Get-Item -LiteralPath $finalApk
$apkHash  = (Get-FileHash -LiteralPath $finalApk -Algorithm SHA256).Hash
$certDn   = (($verify -split "`r?`n" | Where-Object { $_ -like '*certificate DN:*' } | Select-Object -First 1) -replace '^.*certificate DN:\s*', '').Trim()
$certHash = (($verify -split "`r?`n" | Where-Object { $_ -like '*certificate SHA-256 digest:*' } | Select-Object -First 1) -replace '^.*digest:\s*', '').Trim()

$info = @(
    "ChOIceN 手机壳 · 构建信息"
    "生成时间       $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
    "包名           $PackageName"
    "版本           $VersionName (versionCode $VersionCode)"
    "SDK            minSdk $MinSdk / targetSdk $TargetSdk"
    "加载地址       https://choice.imhaoyuan.tyu.me"
    ""
    "文件           $finalApk"
    "大小           $([math]::Round($apkInfo.Length / 1KB, 1)) KB ($($apkInfo.Length) 字节)"
    "SHA-256        $apkHash"
    ""
    "签名者         $certDn"
    "证书 SHA-256   $certHash"
    ""
    "声明的权限："
    $permissions
    ""
    "工具链："
    "  aapt2      $(Get-ToolVersion $tools['aapt2'] @('version'))"
    "  d8         $(Get-ToolVersion $tools['d8'] @('--version'))"
    "  apksigner  $(Get-ToolVersion $tools['apksigner'] @('--version'))"
    "  javac      $(Get-ToolVersion $tools['javac'] @('-version'))"
    "  build-tools $BuildTools / platform $Platform"
)
$infoPath = Join-Path $OutDir 'BUILD-INFO.txt'
$info | Set-Content -LiteralPath $infoPath -Encoding UTF8

Write-Host ""
Write-Host "构建成功" -ForegroundColor Green
Write-Host "  产物    $finalApk  ($([math]::Round($apkInfo.Length / 1KB, 1)) KB)"
Write-Host "  信息    $infoPath"
