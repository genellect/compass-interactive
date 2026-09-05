#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $SourcePackagePath,
    [Parameter(Mandatory)][string] $SignedPackagePath,
    [Parameter(Mandatory)][string] $MakeAppxPath,
    [Parameter(Mandatory)][string] $SignToolPath,
    [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{40}$')]
    [string] $CertificateThumbprint,
    [Parameter(Mandatory)][string] $ExpectedPublisher,
    [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{64}$')]
    [string] $ExpectedSourcePackageSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-MicrosoftSdkTool([string] $Path, [string] $Name) {
    $item = Get-Item -LiteralPath $Path
    try { $version = [version]::Parse($item.VersionInfo.ProductVersion) }
    catch { throw "Unable to determine the $Name version." }
    $toolSignature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($version.Major -ne 10 -or $version.Build -lt 26100 -or
        $toolSignature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
        $toolSignature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:,|$)') {
        throw "$Name must be a valid Microsoft-signed Windows SDK 26100-or-later tool."
    }
}

function Get-PackageFileMap([string] $Root, [switch] $ExcludeSignature) {
    $map = @{}
    foreach ($file in @(Get-ChildItem -LiteralPath $Root -Recurse -File)) {
        $path = [IO.Path]::GetRelativePath($Root, $file.FullName).Replace('\', '/')
        if ($ExcludeSignature -and $path -ceq 'AppxSignature.p7x') { continue }
        $map[$path] = [pscustomobject]@{
            Bytes = $file.Length
            Sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        }
    }
    return $map
}

function Assert-CodeSigningCertificate($Certificate) {
    $now = Get-Date
    if (!$Certificate.HasPrivateKey -or $Certificate.Subject -cne $ExpectedPublisher -or
        $Certificate.NotBefore -gt $now -or $Certificate.NotAfter -le $now) {
        throw 'The local-device certificate must match Publisher, be currently valid, and have its private key.'
    }
    $eku = @($Certificate.Extensions | Where-Object {
        $_ -is [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]
    } | ForEach-Object { $_.EnhancedKeyUsages } | ForEach-Object { $_.Value })
    if ($eku -notcontains '1.3.6.1.5.5.7.3.3') {
        throw 'The local-device certificate must contain the Code Signing EKU.'
    }
}

$source = (Resolve-Path -LiteralPath $SourcePackagePath).Path
$signed = (Resolve-Path -LiteralPath $SignedPackagePath).Path
$makeAppx = (Resolve-Path -LiteralPath $MakeAppxPath).Path
$signTool = (Resolve-Path -LiteralPath $SignToolPath).Path
Assert-MicrosoftSdkTool $makeAppx 'MakeAppx'
Assert-MicrosoftSdkTool $signTool 'SignTool'
$thumbprint = $CertificateThumbprint.ToUpperInvariant()
if ([IO.Path]::GetFileName($source) -cnotmatch '_UNSIGNED_DEVELOPMENT_ONLY\.msix$') {
    throw 'SourcePackagePath must be an *_UNSIGNED_DEVELOPMENT_ONLY.msix package.'
}
if ([IO.Path]::GetFileName($signed) -cnotmatch '_SIGNED_LOCAL_DEVICE_TEST_ONLY\.msix$') {
    throw 'SignedPackagePath must be an *_SIGNED_LOCAL_DEVICE_TEST_ONLY.msix package.'
}
$sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
if ($sourceHash -cne $ExpectedSourcePackageSha256.ToUpperInvariant()) {
    throw 'The source package SHA-256 changed before signed-copy preflight.'
}
$certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint"
Assert-CodeSigningCertificate $certificate
$signature = Get-AuthenticodeSignature -LiteralPath $signed
if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
    $null -eq $signature.SignerCertificate -or
    $signature.SignerCertificate.Thumbprint -ine $thumbprint -or
    $signature.SignerCertificate.Subject -cne $ExpectedPublisher) {
    throw 'The local-device MSIX signature is not trusted or does not match the expected certificate.'
}
$verifyOutput = & $signTool verify /pa /all $signed 2>&1
if ($LASTEXITCODE -ne 0) {
    throw 'SignTool did not verify the local-device MSIX signature.'
}

$scratch = Join-Path ([IO.Path]::GetTempPath()) (
    'compass-presenter-store-local-test-' + [guid]::NewGuid().ToString('N'))
$sourceRoot = Join-Path $scratch 'source'
$signedRoot = Join-Path $scratch 'signed'
try {
    $null = New-Item -ItemType Directory -Path $sourceRoot, $signedRoot
    $null = & $makeAppx unpack /p $source /d $sourceRoot /no 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'MakeAppx could not unpack the source development package.' }
    $null = & $makeAppx unpack /p $signed /d $signedRoot /no 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'MakeAppx could not unpack the signed local-device package.' }
    if (Test-Path -LiteralPath (Join-Path $sourceRoot 'AppxSignature.p7x')) {
        throw 'The source development package must be unsigned.'
    }
    if (!(Test-Path -LiteralPath (Join-Path $signedRoot 'AppxSignature.p7x') -PathType Leaf)) {
        throw 'The signed local-device package does not contain AppxSignature.p7x.'
    }
    $metadata = Get-Content -Raw -LiteralPath (
        Join-Path $signedRoot 'BuildMetadata/store-build.json') | ConvertFrom-Json
    if ($metadata.Status -cne 'UNSIGNED_DEVELOPMENT_ONLY' -or
        $metadata.GeneralDistributionAllowed -ne $false) {
        throw 'The signed copy must retain the development-only embedded boundary.'
    }
    $sourceFiles = Get-PackageFileMap $sourceRoot
    $signedFiles = Get-PackageFileMap $signedRoot -ExcludeSignature
    if ($sourceFiles.Count -ne $signedFiles.Count) {
        throw 'Signing changed the package payload inventory.'
    }
    foreach ($path in $sourceFiles.Keys) {
        if (!$signedFiles.ContainsKey($path) -or
            $signedFiles[$path].Bytes -ne $sourceFiles[$path].Bytes -or
            $signedFiles[$path].Sha256 -cne $sourceFiles[$path].Sha256) {
            throw "Signing changed package payload content: $path"
        }
    }
} finally {
    if (Test-Path -LiteralPath $scratch) {
        Remove-Item -LiteralPath $scratch -Recurse -Force
    }
}

[pscustomobject]@{
    Status = 'SIGNED_LOCAL_DEVICE_TEST_PREFLIGHT_PASS'
    LocalDeviceTestOnly = $true
    GeneralDistributionAllowed = $false
    PartnerCenterUploadAllowed = $false
    SourcePackage = [IO.Path]::GetFileName($source)
    SourcePackageSha256 = $sourceHash.ToLowerInvariant()
    SignedPackage = [IO.Path]::GetFileName($signed)
    SignedPackageSha256 = (Get-FileHash -LiteralPath $signed -Algorithm SHA256).Hash.ToLowerInvariant()
    CertificateThumbprint = $thumbprint
    SignatureDigestAlgorithm = 'SHA256'
}
