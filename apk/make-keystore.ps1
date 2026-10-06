<#
.SYNOPSIS
    生成 ChOIceN 的自用 release 签名钥匙（一次性操作）。

.DESCRIPTION
    产出一个 PKCS12 格式的 .jks 和同目录的 keystore.properties。
    默认落在 %USERPROFILE%\.android\choice-keystore\，刻意放在仓库之外，不进 git。

    ⚠️ 这个目录要备份好。钥匙丢了就无法覆盖升级已安装的应用，只能卸载重装
       （localStorage 里的主题偏好与骰子累计统计会清零）。

.NOTES
    默认用 Zulu 8 的 keytool：它产出的 PKCS12 用最通用的弱 KDF，
    所有版本的 apksigner 都能读，不会有新 JDK 的加密算法兼容问题。
#>
[CmdletBinding()]
param(
    [string]$KeytoolHome = 'C:\Program Files\Zulu\zulu-8',
    [string]$KeystoreDir = (Join-Path $env:USERPROFILE '.android\choice-keystore'),
    [string]$Alias = 'choice',
    [string]$DistinguishedName = 'CN=ChOIceN, OU=choice.imhaoyuan.tyu.me, O=ChOIceN, C=CN',
    [int]$ValidityDays = 10000,
    [string]$Password,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$keytool = Join-Path $KeytoolHome 'bin\keytool.exe'
if (-not (Test-Path -LiteralPath $keytool)) {
    throw "找不到 keytool：$keytool（用 -KeytoolHome 指定一个 JDK 目录）"
}

$jks = Join-Path $KeystoreDir "$Alias-release.jks"
$props = Join-Path $KeystoreDir 'keystore.properties'

if ((Test-Path -LiteralPath $jks) -and -not $Force) {
    Write-Host "签名钥匙已存在，未做任何改动：" -ForegroundColor Yellow
    Write-Host "  $jks"
    Write-Host "要重新生成请加 -Force（注意：旧钥匙一旦覆盖，已安装的应用就无法再覆盖升级）。"
    exit 0
}

if (-not $Password) {
    # 32 位随机口令，存进 keystore.properties（本机文件，不进 git）
    $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    $Password = -join (1..32 | ForEach-Object { $alphabet[(Get-Random -Maximum $alphabet.Length)] })
}

New-Item -ItemType Directory -Force -Path $KeystoreDir | Out-Null

Write-Host "生成签名钥匙（RSA 2048，有效期 $ValidityDays 天）..." -ForegroundColor Cyan
& $keytool -genkeypair `
    -keystore $jks `
    -storetype PKCS12 `
    -alias $Alias `
    -keyalg RSA `
    -keysize 2048 `
    -validity $ValidityDays `
    -dname $DistinguishedName `
    -storepass $Password `
    -keypass $Password
if ($LASTEXITCODE -ne 0) { throw "keytool 失败（exit $LASTEXITCODE）" }

@(
    '# ChOIceN 自用 release 签名（本文件含明文口令，切勿提交、切勿外传）'
    "storeFile=$Alias-release.jks"
    "storePassword=$Password"
    "keyAlias=$Alias"
    "keyPassword=$Password"
) | Set-Content -LiteralPath $props -Encoding UTF8

Write-Host ""
Write-Host "完成：" -ForegroundColor Green
Write-Host "  钥匙    $jks"
Write-Host "  口令    $props"
Write-Host ""
Write-Host "⚠️  请备份上面整个目录。钥匙丢失 = 无法覆盖升级，只能卸载重装，统计会清零。" -ForegroundColor Yellow
