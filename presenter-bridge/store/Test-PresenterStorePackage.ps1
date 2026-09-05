#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $PackagePath,
    [Parameter(Mandatory)][string] $MakeAppxPath,
    [Parameter(Mandatory)][string] $IdentityName,
    [Parameter(Mandatory)][string] $Publisher,
    [Parameter(Mandatory)][string] $PublisherDisplayName,
    [Parameter(Mandatory)][string] $Version,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string] $SourceCommit,
    [Parameter(Mandatory)][ValidateSet('PARTNER_CENTER_SUBMISSION_INPUT_UNSIGNED', 'UNSIGNED_DEVELOPMENT_ONLY')]
    [string] $ExpectedStatus,
    [Parameter(Mandatory)][ValidateSet('MICROSOFT_STANDARD_APPLICATION_LICENSE_TERMS', 'ADDITIONAL_LICENSE_TERMS', 'NOT_SELECTED_UNSIGNED_DEVELOPMENT_ONLY')]
    [string] $ExpectedLicenseTermsMode,
    [Parameter(Mandatory)][object[]] $ExpectedNoticeFiles,
    [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string] $ExpectedPublishedFilesManifestSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Exact([object] $Actual, [object] $Expected, [string] $Label) {
    if ($Actual -cne $Expected) {
        throw "$Label mismatch. Expected '$Expected'; received '$Actual'."
    }
}

function Assert-StoreVersion([string] $Value) {
    $numbers = @()
    foreach ($part in $Value.Split('.')) {
        [uint64] $number = 0
        if (![uint64]::TryParse($part, [ref] $number)) {
            throw 'Store package Version must contain four decimal integers.'
        }
        $numbers += $number
    }
    if ($numbers.Count -ne 4 -or $numbers[0] -lt 1 -or $numbers[0] -gt 65535 -or
        $numbers[1] -gt 65535 -or $numbers[2] -gt 65535 -or $numbers[3] -ne 0) {
        throw 'Store package Version requires Major 1..65535, Minor 0..65535, Build 0..65535, and Revision exactly 0.'
    }
}

function Get-PublishedFilesManifestSha256([object[]] $Entries) {
    $canonical = ($Entries | Sort-Object Path | ForEach-Object {
        "$($_.Path)`t$($_.Bytes)`t$($_.Sha256.ToLowerInvariant())"
    }) -join "`n"
    $bytes = [Text.Encoding]::UTF8.GetBytes($canonical)
    try {
        return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
    } finally {
        [Security.Cryptography.CryptographicOperations]::ZeroMemory($bytes)
    }
}

Assert-StoreVersion $Version
if ($PublisherDisplayName -match '[\r\n]' -or
    $PublisherDisplayName -notmatch '^\S.*\S$|^\S$') {
    throw 'PublisherDisplayName must be non-empty and cannot contain CR or LF.'
}
$package = (Resolve-Path -LiteralPath $PackagePath).Path
$makeAppx = (Resolve-Path -LiteralPath $MakeAppxPath).Path
$makeAppxVersionText = (Get-Item -LiteralPath $makeAppx).VersionInfo.ProductVersion
try { $makeAppxVersion = [version]::Parse($makeAppxVersionText) } catch { throw 'Unable to determine the MakeAppx version.' }
if ($makeAppxVersion.Major -ne 10 -or $makeAppxVersion.Build -lt 26100) {
    throw 'MakeAppx from Windows SDK 10.0.26100.0 or later is required for package preflight.'
}
$makeAppxSignature = Get-AuthenticodeSignature -LiteralPath $makeAppx
if ($makeAppxSignature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
    $makeAppxSignature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:,|$)') {
    throw 'MakeAppx must have a valid Microsoft Corporation Authenticode signature.'
}
$makeAppxSha256 = (Get-FileHash -LiteralPath $makeAppx -Algorithm SHA256).Hash
$scratch = Join-Path ([IO.Path]::GetTempPath()) ("compass-presenter-store-test-" + [guid]::NewGuid().ToString('N'))
$unpacked = Join-Path $scratch 'unpacked'

try {
    $null = New-Item -ItemType Directory -Path $scratch, $unpacked
    $makeAppxOutput = & $makeAppx unpack /p $package /d $unpacked /no 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "MakeAppx package validation/unpack failed: $($makeAppxOutput -join [Environment]::NewLine)"
    }

    if (Test-Path -LiteralPath (Join-Path $unpacked 'AppxSignature.p7x')) {
        throw 'The pre-ingestion package unexpectedly contains a signature.'
    }

    $manifestPath = Join-Path $unpacked 'AppxManifest.xml'
    [xml] $manifest = Get-Content -Raw -LiteralPath $manifestPath
    $namespaces = [Xml.XmlNamespaceManager]::new($manifest.NameTable)
    $namespaces.AddNamespace('f', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
    $namespaces.AddNamespace('uap', 'http://schemas.microsoft.com/appx/manifest/uap/windows10')
    $namespaces.AddNamespace('uap10', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/10')
    $namespaces.AddNamespace('uap17', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/17')
    $namespaces.AddNamespace('desktop', 'http://schemas.microsoft.com/appx/manifest/desktop/windows10')
    $namespaces.AddNamespace('rescap', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities')

    $identity = $manifest.SelectSingleNode('/f:Package/f:Identity', $namespaces)
    Assert-Exact $identity.GetAttribute('Name') $IdentityName 'Identity Name'
    Assert-Exact $identity.GetAttribute('Publisher') $Publisher 'Identity Publisher'
    Assert-Exact $identity.GetAttribute('Version') $Version 'Identity Version'
    Assert-Exact $identity.GetAttribute('ProcessorArchitecture') 'x64' 'ProcessorArchitecture'
    Assert-Exact $manifest.SelectSingleNode('/f:Package/f:Properties/f:PublisherDisplayName', $namespaces).InnerText $PublisherDisplayName 'PublisherDisplayName'
    Assert-Exact $manifest.SelectSingleNode('/f:Package/f:Properties/f:Description', $namespaces).InnerText 'COMPASS Interactive講義でPowerPointのページを同期します。' 'Package description'

    $resources = @($manifest.SelectNodes(
        '/f:Package/f:Resources/f:Resource',
        $namespaces))
    if ($resources.Count -ne 1 -or
        $resources[0].GetAttribute('Language') -cne 'ja-JP') {
        throw 'The initial Store package must declare only the ja-JP resource.'
    }

    $target = $manifest.SelectSingleNode('/f:Package/f:Dependencies/f:TargetDeviceFamily', $namespaces)
    Assert-Exact $target.GetAttribute('Name') 'Windows.Desktop' 'TargetDeviceFamily'
    Assert-Exact $target.GetAttribute('MinVersion') '10.0.26100.0' 'Minimum OS'
    Assert-Exact $target.GetAttribute('MaxVersionTested') '10.0.26100.0' 'Maximum tested OS'
    Assert-Exact $manifest.SelectSingleNode('/f:Package/f:Properties/uap17:UpdateWhileInUse', $namespaces).InnerText 'defer' 'UpdateWhileInUse'

    $application = $manifest.SelectSingleNode('/f:Package/f:Applications/f:Application', $namespaces)
    Assert-Exact $application.GetAttribute('Executable') 'COMPASS.PresenterBridge.exe' 'Application executable'
    Assert-Exact $application.GetAttribute('RuntimeBehavior', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/10') 'packagedClassicApp' 'RuntimeBehavior'
    Assert-Exact $application.GetAttribute('TrustLevel', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/10') 'mediumIL' 'TrustLevel'
    $visualElements = $application.SelectSingleNode('uap:VisualElements', $namespaces)
    Assert-Exact $visualElements.GetAttribute('Description') 'COMPASS Interactive講義でPowerPointのページを同期します。' 'VisualElements description'

    $startup = $manifest.SelectSingleNode('/f:Package/f:Applications/f:Application/f:Extensions/desktop:Extension/desktop:StartupTask', $namespaces)
    if ($null -eq $startup) { throw 'The startup task is missing.' }
    Assert-Exact $startup.GetAttribute('Enabled') 'true' 'StartupTask Enabled'
    $capabilities = @($manifest.SelectNodes('/f:Package/f:Capabilities/*', $namespaces))
    if ($capabilities.Count -ne 1 -or $capabilities[0].LocalName -cne 'Capability' -or
        $capabilities[0].NamespaceURI -cne 'http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities' -or
        $capabilities[0].GetAttribute('Name') -cne 'runFullTrust') {
        throw 'The package must declare only the runFullTrust restricted capability.'
    }

    $metadataPath = Join-Path $unpacked 'BuildMetadata/store-build.json'
    $metadata = Get-Content -Raw -LiteralPath $metadataPath | ConvertFrom-Json
    Assert-Exact $metadata.Status $ExpectedStatus 'Build status'
    Assert-Exact $metadata.SourceCommit $SourceCommit 'Source commit'
    Assert-Exact $metadata.IdentityName $IdentityName 'Metadata identity'
    Assert-Exact $metadata.Publisher $Publisher 'Metadata publisher'
    Assert-Exact $metadata.PublisherDisplayName $PublisherDisplayName 'Metadata publisher display name'
    Assert-Exact $metadata.LicenseTermsMode $ExpectedLicenseTermsMode 'License terms mode'
    Assert-Exact $metadata.MakeAppxVersion $makeAppxVersion.ToString() 'MakeAppx version'
    Assert-Exact $metadata.MakeAppxSha256.ToUpperInvariant() $makeAppxSha256 'MakeAppx hash'
    Assert-Exact $metadata.MinimumOsBuild 26100 'Minimum accepted OS build'
    Assert-Exact $metadata.UpdateContinuityAcceptedMinimumOsBuild 26100 'Accepted update-continuity OS build'

    $publishedFiles = @($metadata.PublishedFiles)
    if ($publishedFiles.Count -eq 0) { throw 'The embedded publish file manifest is empty.' }
    $publishedManifestHash = Get-PublishedFilesManifestSha256 $publishedFiles
    Assert-Exact $metadata.PublishedFilesManifestSha256.ToUpperInvariant() $publishedManifestHash.ToUpperInvariant() 'Embedded publish file manifest hash'
    Assert-Exact $publishedManifestHash.ToUpperInvariant() $ExpectedPublishedFilesManifestSha256.ToUpperInvariant() 'Expected publish file manifest hash'
    $publishedPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($publishedFile in $publishedFiles) {
        if (!$publishedPaths.Add($publishedFile.Path)) { throw "Duplicate published file path: $($publishedFile.Path)" }
        $publishedPath = Join-Path $unpacked $publishedFile.Path
        if (!(Test-Path -LiteralPath $publishedPath -PathType Leaf)) { throw "Published file is missing from package: $($publishedFile.Path)" }
        Assert-Exact (Get-Item -LiteralPath $publishedPath).Length ([long] $publishedFile.Bytes) "$($publishedFile.Path) size"
        Assert-Exact (Get-FileHash -LiteralPath $publishedPath -Algorithm SHA256).Hash $publishedFile.Sha256.ToUpperInvariant() "$($publishedFile.Path) hash"
    }

    $expectedByKind = @{}
    foreach ($expectedNotice in $ExpectedNoticeFiles) {
        $expectedByKind[$expectedNotice.Kind] = $expectedNotice
    }
    $metadataNotices = @($metadata.NoticeFiles)
    if ($metadataNotices.Count -ne $ExpectedNoticeFiles.Count) {
        throw 'The packaged notice inventory count does not match the build inputs.'
    }
    foreach ($notice in $metadataNotices) {
        if (!$expectedByKind.ContainsKey($notice.Kind)) { throw "Unexpected packaged notice: $($notice.Kind)" }
        $expectedNotice = $expectedByKind[$notice.Kind]
        Assert-Exact $notice.PackagePath $expectedNotice.PackagePath "$($notice.Kind) package path"
        Assert-Exact $notice.Sha256.ToUpperInvariant() $expectedNotice.Sha256.ToUpperInvariant() "$($notice.Kind) metadata hash"
        $noticePath = Join-Path $unpacked $notice.PackagePath
        if (!(Test-Path -LiteralPath $noticePath -PathType Leaf)) { throw "Packaged notice is missing: $($notice.Kind)" }
        Assert-Exact (Get-FileHash -LiteralPath $noticePath -Algorithm SHA256).Hash $expectedNotice.Sha256.ToUpperInvariant() "$($notice.Kind) content hash"
    }
    foreach ($requiredNoticeKind in @('COMPASS_BINARY_NOTICE', 'COMPASS_THIRD_PARTY_NOTICES', 'DOTNET_LICENSE', 'DOTNET_THIRD_PARTY_NOTICES')) {
        if (!$expectedByKind.ContainsKey($requiredNoticeKind)) { throw "Required notice input is missing: $requiredNoticeKind" }
    }
    if ($ExpectedLicenseTermsMode -eq 'ADDITIONAL_LICENSE_TERMS' -and !$expectedByKind.ContainsKey('ADDITIONAL_LICENSE_TERMS')) {
        throw 'Additional license terms mode requires the exact terms file in the package.'
    }

    $allowedPackageFiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($path in $publishedPaths) { $null = $allowedPackageFiles.Add($path) }
    foreach ($path in @(
        'AppxManifest.xml',
        'AppxBlockMap.xml',
        '[Content_Types].xml',
        'AppxMetadata/CodeIntegrity.cat',
        'Assets/StoreLogo.png',
        'Assets/Square150x150Logo.png',
        'Assets/Square44x44Logo.png',
        'BuildMetadata/store-build.json'
    )) { $null = $allowedPackageFiles.Add($path) }
    foreach ($notice in $metadataNotices) { $null = $allowedPackageFiles.Add($notice.PackagePath) }
    foreach ($packagedFile in @(Get-ChildItem -LiteralPath $unpacked -Recurse -File)) {
        $relativePath = [IO.Path]::GetRelativePath($unpacked, $packagedFile.FullName).Replace('\', '/')
        if (!$allowedPackageFiles.Contains($relativePath)) {
            throw "Unexpected file is present outside the exact publish/notice manifest: $relativePath"
        }
    }

    foreach ($required in @('COMPASS.PresenterBridge.exe', 'Compass.Presenter.Core.dll', 'Compass.Presenter.Loopback.dll', 'Compass.Presenter.PowerPoint.External.dll')) {
        if (!(Test-Path -LiteralPath (Join-Path $unpacked $required) -PathType Leaf)) {
            throw "Required runtime file is missing: $required"
        }
    }
    $forbiddenNames = @(Get-ChildItem -LiteralPath $unpacked -Recurse -File | Where-Object {
        $_.Name -match '(?i)^Update\.exe$|Velopack|releases\..+\.json$|\.nupkg$|\.p7s$'
    })
    if ($forbiddenNames.Count -gt 0) {
        throw "Direct-distribution update payload leaked into Store package: $($forbiddenNames[0].Name)"
    }

    foreach ($file in @(Get-ChildItem -LiteralPath $unpacked -Recurse -File | Where-Object { $_.Extension -in @('.exe', '.dll', '.json') })) {
        $bytes = [IO.File]::ReadAllBytes($file.FullName)
        $ascii = [Text.Encoding]::ASCII.GetString($bytes)
        $unicode = [Text.Encoding]::Unicode.GetString($bytes)
        foreach ($marker in @('presenter-updates.yuto-matsui.com', 'VelopackPresenterUpdater', 'PresenterUpdateCoordinator')) {
            if ($ascii.Contains($marker, [StringComparison]::OrdinalIgnoreCase) -or
                $unicode.Contains($marker, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Direct-distribution updater marker '$marker' leaked into $($file.Name)."
            }
        }
    }

    [pscustomobject]@{
        Status = 'STORE_PACKAGE_PREFLIGHT_PASS'
        Package = $package
        IdentityName = $IdentityName
        Version = $Version
        BuildStatus = $ExpectedStatus
        MakeAppxVersion = $makeAppxVersion.ToString()
        MakeAppxSha256 = $makeAppxSha256.ToLowerInvariant()
        MinimumOsBuild = 26100
        UpdateContinuityAcceptedMinimumOsBuild = 26100
    }
} finally {
    if (Test-Path -LiteralPath $scratch) {
        Remove-Item -LiteralPath $scratch -Recurse -Force
    }
}
