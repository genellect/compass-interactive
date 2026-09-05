#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $SourcePackagePath,
    [Parameter(Mandatory)][string] $OutputRoot,
    [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{40}$')]
    [string] $CertificateThumbprint,
    [Parameter(Mandatory)][string] $MakeAppxPath,
    [Parameter(Mandatory)][string] $SignToolPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-MicrosoftSdkTool([string] $Path, [string] $Name) {
    $item = Get-Item -LiteralPath $Path
    try { $version = [version]::Parse($item.VersionInfo.ProductVersion) }
    catch { throw "Unable to determine the $Name version." }
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($version.Major -ne 10 -or $version.Build -lt 26100 -or
        $signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
        $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:,|$)') {
        throw "$Name must be a valid Microsoft-signed Windows SDK 26100-or-later tool."
    }
}

function Assert-CodeSigningCertificate($Certificate, [string] $Publisher) {
    $now = Get-Date
    if (!$Certificate.HasPrivateKey -or $Certificate.Subject -cne $Publisher -or
        $Certificate.NotBefore -gt $now -or $Certificate.NotAfter -le $now) {
        throw 'The certificate must match the package Publisher, be currently valid, and have its private key.'
    }
    $eku = @($Certificate.Extensions | Where-Object {
        $_ -is [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]
    } | ForEach-Object { $_.EnhancedKeyUsages } | ForEach-Object { $_.Value })
    if ($eku -notcontains '1.3.6.1.5.5.7.3.3') {
        throw 'The certificate must contain the Code Signing EKU.'
    }
}

$bridgeRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $bridgeRoot
$source = (Resolve-Path -LiteralPath $SourcePackagePath).Path
$output = [IO.Path]::GetFullPath($OutputRoot)
$checkout = [IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\', '/')
$outputBoundary = $output.TrimEnd('\', '/')
if ($outputBoundary.Equals($checkout, [StringComparison]::OrdinalIgnoreCase) -or
    $outputBoundary.StartsWith($checkout + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputRoot must be outside the source checkout.'
}
if (Test-Path -LiteralPath $output) { throw 'OutputRoot must be new; local-device test packages are never overwritten.' }
if ([IO.Path]::GetFileName($source) -cnotmatch '_UNSIGNED_DEVELOPMENT_ONLY\.msix$') {
    throw 'Only an *_UNSIGNED_DEVELOPMENT_ONLY.msix source package is accepted.'
}
$makeAppx = (Resolve-Path -LiteralPath $MakeAppxPath).Path
$signTool = (Resolve-Path -LiteralPath $SignToolPath).Path
Assert-MicrosoftSdkTool $makeAppx 'MakeAppx'
Assert-MicrosoftSdkTool $signTool 'SignTool'

$inspect = Join-Path ([IO.Path]::GetTempPath()) (
    'compass-presenter-store-sign-input-' + [guid]::NewGuid().ToString('N'))
try {
    $null = New-Item -ItemType Directory -Path $inspect
    $null = & $makeAppx unpack /p $source /d $inspect /no 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'MakeAppx could not inspect the source development package.' }
    if (Test-Path -LiteralPath (Join-Path $inspect 'AppxSignature.p7x')) {
        throw 'The source development package is already signed.'
    }
    $metadata = Get-Content -Raw -LiteralPath (
        Join-Path $inspect 'BuildMetadata/store-build.json') | ConvertFrom-Json
    [xml] $manifest = Get-Content -Raw -LiteralPath (Join-Path $inspect 'AppxManifest.xml')
    $namespace = [Xml.XmlNamespaceManager]::new($manifest.NameTable)
    $namespace.AddNamespace('f', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
    $identity = $manifest.SelectSingleNode('/f:Package/f:Identity', $namespace)
    if ($metadata.Status -cne 'UNSIGNED_DEVELOPMENT_ONLY' -or
        $metadata.GeneralDistributionAllowed -ne $false) {
        throw 'The source package is not an UNSIGNED_DEVELOPMENT_ONLY artifact.'
    }
    $publisher = $identity.GetAttribute('Publisher')
    $sourcePreflight = & "$PSScriptRoot/Test-PresenterStorePackage.ps1" `
        -PackagePath $source `
        -MakeAppxPath $makeAppx `
        -IdentityName $metadata.IdentityName `
        -Publisher $publisher `
        -PublisherDisplayName $metadata.PublisherDisplayName `
        -Version $metadata.Version `
        -SourceCommit $metadata.SourceCommit `
        -ExpectedStatus 'UNSIGNED_DEVELOPMENT_ONLY' `
        -ExpectedLicenseTermsMode $metadata.LicenseTermsMode `
        -ExpectedNoticeFiles @($metadata.NoticeFiles) `
        -ExpectedPublishedFilesManifestSha256 $metadata.PublishedFilesManifestSha256
    if ($sourcePreflight.Status -cne 'STORE_PACKAGE_PREFLIGHT_PASS') {
        throw 'The source development package did not pass Store package preflight.'
    }
} finally {
    if (Test-Path -LiteralPath $inspect) {
        Remove-Item -LiteralPath $inspect -Recurse -Force
    }
}

$thumbprint = $CertificateThumbprint.ToUpperInvariant()
$certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint"
Assert-CodeSigningCertificate $certificate $publisher
$sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
$signedName = [IO.Path]::GetFileName($source) -replace
    '_UNSIGNED_DEVELOPMENT_ONLY\.msix$', '_SIGNED_LOCAL_DEVICE_TEST_ONLY.msix'
$signScratch = Join-Path ([IO.Path]::GetTempPath()) (
    'compass-presenter-store-sign-work-' + [guid]::NewGuid().ToString('N'))
try {
    $null = New-Item -ItemType Directory -Path $signScratch
    $signedWork = Join-Path $signScratch $signedName
    Copy-Item -LiteralPath $source -Destination $signedWork
    $null = & $signTool sign /s My /sha1 $thumbprint /fd SHA256 $signedWork 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'SignTool could not create the local-device test signature.' }
    $preflight = & "$PSScriptRoot/Test-PresenterStoreLocalDeviceTestPackage.ps1" `
        -SourcePackagePath $source `
        -SignedPackagePath $signedWork `
        -MakeAppxPath $makeAppx `
        -SignToolPath $signTool `
        -CertificateThumbprint $thumbprint `
        -ExpectedPublisher $publisher `
        -ExpectedSourcePackageSha256 $sourceHash
    if ($preflight.Status -cne 'SIGNED_LOCAL_DEVICE_TEST_PREFLIGHT_PASS') {
        throw 'The signed local-device package did not pass preflight.'
    }

    $ready = Join-Path $output 'ready'
    $null = New-Item -ItemType Directory -Path $ready
    $signedReady = Join-Path $ready $signedName
    Copy-Item -LiteralPath $signedWork -Destination $signedReady
    $receipt = [pscustomobject]@{
        Status = 'SIGNED_LOCAL_DEVICE_TEST_ONLY'
        LocalDeviceTestOnly = $true
        GeneralDistributionAllowed = $false
        PartnerCenterUploadAllowed = $false
        StoreSubmissionAllowed = $false
        DistributionBoundary = 'Install only on a controlled local test device; never distribute or upload to Partner Center.'
        SourcePackage = [IO.Path]::GetFileName($source)
        SourcePackageBytes = (Get-Item -LiteralPath $source).Length
        SourcePackageSha256 = $sourceHash.ToLowerInvariant()
        SignedPackage = $signedName
        SignedPackageBytes = (Get-Item -LiteralPath $signedReady).Length
        SignedPackageSha256 = (Get-FileHash -LiteralPath $signedReady -Algorithm SHA256).Hash.ToLowerInvariant()
        Publisher = $publisher
        CertificateThumbprint = $thumbprint
        CertificateNotAfterUtc = $certificate.NotAfter.ToUniversalTime().ToString('O')
        SignatureDigestAlgorithm = 'SHA256'
        PackagePreflight = $preflight.Status
    }
    $receipt | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (
        Join-Path $ready 'local-device-test-receipt.json') -Encoding utf8NoBOM
    $receipt
    Write-Warning 'SIGNED_LOCAL_DEVICE_TEST_ONLY: never distribute this package or upload it to Partner Center.'
} finally {
    if (Test-Path -LiteralPath $signScratch) {
        Remove-Item -LiteralPath $signScratch -Recurse -Force
    }
}
