#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $Version,
    [Parameter(Mandatory)][string] $OutputRoot,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string] $SourceCommit,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9.-]{3,50}$')][string] $IdentityName,
    [Parameter(Mandatory)][string] $Publisher,
    [Parameter(Mandatory)][string] $PublisherDisplayName,
    [switch] $UseMicrosoftStandardApplicationLicenseTerms,
    [string] $AdditionalLicenseTermsPath,
    [Parameter(Mandatory)][string] $MakeAppxPath,
    [string] $DotnetPath = 'dotnet',
    [switch] $PartnerCenterIdentityConfirmed,
    [switch] $UnsignedDevelopmentOnly,
    [switch] $AllowDirtyDevelopmentCheckout
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

Assert-StoreVersion $Version
$bridgeRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $bridgeRoot
$output = [IO.Path]::GetFullPath($OutputRoot)
$trimSeparators = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$checkout = [IO.Path]::GetFullPath($repositoryRoot).TrimEnd($trimSeparators)
$outputBoundary = $output.TrimEnd($trimSeparators)
if ($outputBoundary.Equals($checkout, [StringComparison]::OrdinalIgnoreCase) -or
    $outputBoundary.StartsWith($checkout + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputRoot must be outside the source checkout so release output cannot invalidate clean-source evidence.'
}
if (Test-Path -LiteralPath $output) { throw 'OutputRoot must be new; Store artifacts are never overwritten.' }
$makeAppx = (Resolve-Path -LiteralPath $MakeAppxPath).Path
$dotnet = (Get-Command $DotnetPath -ErrorAction Stop).Source
$makeAppxVersionText = (Get-Item -LiteralPath $makeAppx).VersionInfo.ProductVersion
try { $makeAppxVersion = [version]::Parse($makeAppxVersionText) } catch { throw 'Unable to determine the MakeAppx version.' }
if ($makeAppxVersion.Major -ne 10 -or $makeAppxVersion.Build -lt 26100) {
    throw 'MakeAppx from Windows SDK 10.0.26100.0 or later is required for uap17:UpdateWhileInUse.'
}
$makeAppxSignature = Get-AuthenticodeSignature -LiteralPath $makeAppx
if ($makeAppxSignature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
    $makeAppxSignature.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:,|$)') {
    throw 'MakeAppx must have a valid Microsoft Corporation Authenticode signature.'
}
$makeAppxSha256 = (Get-FileHash -LiteralPath $makeAppx -Algorithm SHA256).Hash.ToLowerInvariant()
$additionalLicenseTerms = if ($AdditionalLicenseTermsPath) { (Resolve-Path -LiteralPath $AdditionalLicenseTermsPath).Path } else { $null }
if ($UseMicrosoftStandardApplicationLicenseTerms -and $additionalLicenseTerms) {
    throw 'Choose either Microsoft Standard Application License Terms or AdditionalLicenseTermsPath, never both.'
}
if (!$UnsignedDevelopmentOnly -and !$UseMicrosoftStandardApplicationLicenseTerms -and !$additionalLicenseTerms) {
    throw 'Select UseMicrosoftStandardApplicationLicenseTerms or supply AdditionalLicenseTermsPath for a Partner Center submission input.'
}
if ($additionalLicenseTerms -and (Get-Item -LiteralPath $additionalLicenseTerms).Length -eq 0) {
    throw 'AdditionalLicenseTermsPath must identify a non-empty approved terms file.'
}
if ($Publisher -notmatch '^CN=\S' -or $Publisher -match '[\r\n]' -or
    $PublisherDisplayName -match '[\r\n]' -or
    $PublisherDisplayName -notmatch '^\S.*\S$|^\S$') {
    throw 'Publisher must be an exact X.500 subject beginning with CN=, and PublisherDisplayName must be non-empty.'
}
if ($PublisherDisplayName.Length -gt 256) { throw 'PublisherDisplayName exceeds the manifest limit.' }
if ($AllowDirtyDevelopmentCheckout -and !$UnsignedDevelopmentOnly) {
    throw 'AllowDirtyDevelopmentCheckout is permitted only for UNSIGNED_DEVELOPMENT_ONLY builds.'
}
if (!$UnsignedDevelopmentOnly) {
    if (!$PartnerCenterIdentityConfirmed) {
        throw 'PartnerCenterIdentityConfirmed is required. Copy IdentityName, Publisher and PublisherDisplayName from the reserved Partner Center product.'
    }
    foreach ($value in @($IdentityName, $Publisher, $PublisherDisplayName)) {
        if ($value -match '(?i)required|placeholder|replace|example|contoso|development|unsigned|todo') {
            throw 'Placeholder or development identity values cannot produce a Partner Center submission input.'
        }
    }
}

function Invoke-Dotnet([string[]] $Arguments) {
    & $dotnet @Arguments
    if ($LASTEXITCODE -ne 0) { throw "dotnet $($Arguments[0]) failed." }
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

function New-StoreAsset([string] $Path, [int] $Size) {
    Add-Type -AssemblyName System.Drawing
    $bitmap = [Drawing.Bitmap]::new($Size, $Size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $background = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#08131f'))
    $arc = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#45d6c4'), [Math]::Max(3, [Math]::Round($Size * 0.125)))
    $accent = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#f4b942'))
    $end = [Drawing.SolidBrush]::new([Drawing.Color]::White)
    try {
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.FillRectangle($background, 0, 0, $Size, $Size)
        $padding = [Math]::Round($Size * 0.22)
        $diameter = $Size - (2 * $padding)
        $graphics.DrawArc($arc, $padding, $padding, $diameter, $diameter, 45, 270)
        $dot = [Math]::Max(3, [Math]::Round($Size * 0.125))
        $x = [Math]::Round($Size * 0.70) - ($dot / 2)
        $graphics.FillEllipse($accent, $x, [Math]::Round($Size * 0.22) - ($dot / 2), $dot, $dot)
        $graphics.FillEllipse($end, $x, [Math]::Round($Size * 0.78) - ($dot / 2), $dot, $dot)
        $bitmap.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $end.Dispose()
        $accent.Dispose()
        $arc.Dispose()
        $background.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$buildStatus = if ($UnsignedDevelopmentOnly) { 'UNSIGNED_DEVELOPMENT_ONLY' } else { 'PARTNER_CENTER_SUBMISSION_INPUT_UNSIGNED' }
$licenseTermsMode = if ($UseMicrosoftStandardApplicationLicenseTerms) {
    'MICROSOFT_STANDARD_APPLICATION_LICENSE_TERMS'
} elseif ($additionalLicenseTerms) {
    'ADDITIONAL_LICENSE_TERMS'
} else {
    'NOT_SELECTED_UNSIGNED_DEVELOPMENT_ONLY'
}
$compassBinaryNotice = Join-Path $PSScriptRoot 'COMPASS-BINARY-NOTICE.txt'
$repositoryThirdPartyNotices = Join-Path $repositoryRoot 'THIRD_PARTY_NOTICES.md'
$dotnetRoot = Split-Path -Parent $dotnet
$dotnetLicense = Join-Path $dotnetRoot 'LICENSE.txt'
$dotnetThirdPartyNotices = Join-Path $dotnetRoot 'ThirdPartyNotices.txt'
foreach ($requiredNotice in @($compassBinaryNotice, $repositoryThirdPartyNotices, $dotnetLicense, $dotnetThirdPartyNotices)) {
    if (!(Test-Path -LiteralPath $requiredNotice -PathType Leaf) -or (Get-Item -LiteralPath $requiredNotice).Length -eq 0) {
        throw "Required exact notice file is missing or empty: $requiredNotice"
    }
}

Push-Location $bridgeRoot
try {
    $head = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $head -cne $SourceCommit) { throw 'SourceCommit must equal checkout HEAD.' }
    $dirty = & git status --porcelain --untracked-files=all
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect source checkout state.' }
    if ($dirty -and !$AllowDirtyDevelopmentCheckout) { throw 'A clean reviewed source checkout is required.' }

    $sdk = (& $dotnet --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $sdk -notmatch '^10\.0\.30\d+$') { throw 'The pinned .NET 10.0.302 feature band is required.' }

    $null = New-Item -ItemType Directory -Path $output
    $work = Join-Path $output 'work'
    $publish = Join-Path $work 'publish'
    $packageRoot = Join-Path $work 'package-root'
    $assets = Join-Path $packageRoot 'Assets'
    $metadataDirectory = Join-Path $packageRoot 'BuildMetadata'
    $licenseDirectory = Join-Path $packageRoot 'Licenses'
    $null = New-Item -ItemType Directory -Path $work, $publish, $packageRoot, $assets, $metadataDirectory, $licenseDirectory

    $project = 'src/Compass.Presenter.App/Compass.Presenter.App.csproj'
    Invoke-Dotnet @('restore', $project, '--runtime', 'win-x64', '--locked-mode', '-p:PresenterDistribution=Store', '-p:SelfContained=true')
    Invoke-Dotnet @('publish', $project, '--configuration', 'Release', '--runtime', 'win-x64', '--self-contained', 'true', '--no-restore', '-p:PresenterDistribution=Store', '-p:PlatformTarget=x64', '-p:DebugSymbols=false', '-p:DebugType=None', "-p:Version=$Version", '--output', $publish)

    $publishedFiles = @(Get-ChildItem -LiteralPath $publish -Recurse -File)
    if (!($publishedFiles | Where-Object { [IO.Path]::GetRelativePath($publish, $_.FullName) -ceq 'COMPASS.PresenterBridge.exe' })) { throw 'Published Presenter executable is missing.' }
    if ($publishedFiles | Where-Object { $_.Name -match '(?i)Velopack|^Update\.exe$|\.nupkg$|\.p7s$' }) {
        throw 'Direct-distribution updater content is present in the Store publish output.'
    }
    $publishedFilesManifest = [Collections.Generic.List[object]]::new()
    foreach ($file in $publishedFiles) {
        $relativePath = [IO.Path]::GetRelativePath($publish, $file.FullName).Replace('\', '/')
        $destination = Join-Path $packageRoot $relativePath
        $destinationDirectory = Split-Path -Parent $destination
        if (!(Test-Path -LiteralPath $destinationDirectory)) {
            $null = New-Item -ItemType Directory -Path $destinationDirectory
        }
        Copy-Item -LiteralPath $file.FullName -Destination $destination
        $publishedFilesManifest.Add([pscustomobject]@{
            Path = $relativePath
            Bytes = $file.Length
            Sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        })
    }
    $publishedFilesManifestSha256 = Get-PublishedFilesManifestSha256 $publishedFilesManifest

    New-StoreAsset (Join-Path $assets 'StoreLogo.png') 50
    New-StoreAsset (Join-Path $assets 'Square150x150Logo.png') 150
    New-StoreAsset (Join-Path $assets 'Square44x44Logo.png') 44

    $noticeFiles = [Collections.Generic.List[object]]::new()
    foreach ($notice in @(
        @{ Source = $compassBinaryNotice; PackagePath = 'Licenses/COMPASS-BINARY-NOTICE.txt'; Kind = 'COMPASS_BINARY_NOTICE' },
        @{ Source = $repositoryThirdPartyNotices; PackagePath = 'Licenses/COMPASS-THIRD-PARTY-NOTICES.md'; Kind = 'COMPASS_THIRD_PARTY_NOTICES' },
        @{ Source = $dotnetLicense; PackagePath = 'Licenses/DOTNET-LICENSE.txt'; Kind = 'DOTNET_LICENSE' },
        @{ Source = $dotnetThirdPartyNotices; PackagePath = 'Licenses/DOTNET-THIRD-PARTY-NOTICES.txt'; Kind = 'DOTNET_THIRD_PARTY_NOTICES' }
    )) {
        $destination = Join-Path $packageRoot $notice.PackagePath
        Copy-Item -LiteralPath $notice.Source -Destination $destination
        $noticeFiles.Add([pscustomobject]@{
            Kind = $notice.Kind
            PackagePath = $notice.PackagePath
            Sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        })
    }
    if ($additionalLicenseTerms) {
        $termsExtension = [IO.Path]::GetExtension($additionalLicenseTerms)
        if (!$termsExtension) { $termsExtension = '.txt' }
        $termsPackagePath = "Licenses/AdditionalLicenseTerms$termsExtension"
        $termsDestination = Join-Path $packageRoot $termsPackagePath
        Copy-Item -LiteralPath $additionalLicenseTerms -Destination $termsDestination
        $noticeFiles.Add([pscustomobject]@{
            Kind = 'ADDITIONAL_LICENSE_TERMS'
            PackagePath = $termsPackagePath
            Sha256 = (Get-FileHash -LiteralPath $termsDestination -Algorithm SHA256).Hash.ToLowerInvariant()
        })
    }

    [xml] $manifest = Get-Content -Raw -LiteralPath 'store/AppxManifest.template.xml'
    $namespaces = [Xml.XmlNamespaceManager]::new($manifest.NameTable)
    $namespaces.AddNamespace('f', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
    $identity = $manifest.SelectSingleNode('/f:Package/f:Identity', $namespaces)
    $identity.SetAttribute('Name', $IdentityName)
    $identity.SetAttribute('Publisher', $Publisher)
    $identity.SetAttribute('Version', $Version)
    $manifest.SelectSingleNode('/f:Package/f:Properties/f:PublisherDisplayName', $namespaces).InnerText = $PublisherDisplayName
    $manifest.Save((Join-Path $packageRoot 'AppxManifest.xml'))

    [pscustomobject]@{
        Status = $buildStatus
        GeneralDistributionAllowed = $false
        DistributionBoundary = if ($UnsignedDevelopmentOnly) { 'Development inspection only; never upload or distribute.' } else { 'Upload only to the matching reserved Partner Center product; do not sideload or distribute before Store certification and signing.' }
        SourceCommit = $SourceCommit
        SourceCheckout = if ($dirty) { 'DIRTY_UNREVIEWED' } else { 'CLEAN_EXACT_COMMIT' }
        IdentityName = $IdentityName
        Publisher = $Publisher
        PublisherDisplayName = $PublisherDisplayName
        Version = $Version
        Architecture = 'x64'
        Runtime = 'win-x64-self-contained'
        DotnetSdkVersion = $sdk
        MakeAppxVersion = $makeAppxVersion.ToString()
        MakeAppxSha256 = $makeAppxSha256
        PublishedFiles = $publishedFilesManifest
        PublishedFilesManifestSha256 = $publishedFilesManifestSha256
        LicenseTermsMode = $licenseTermsMode
        LicenseTermsApproval = 'OPERATOR_ATTESTATION_REQUIRED_IN_PARTNER_CENTER'
        NoticeFiles = $noticeFiles
        MinimumOsBuild = 26100
        UpdateWhileInUse = 'defer'
        UpdateWhileInUseMinimumOsBuild = 26100
        UpdateContinuityAcceptedMinimumOsBuild = 26100
        DownlevelAcceptance = 'NOT_ELIGIBLE_V1: Windows builds 19041-26099 require a later compatibility expansion after real update-in-use testing.'
        SelfUpdate = 'ABSENT_STORE_MANAGED'
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $metadataDirectory 'store-build.json') -Encoding utf8NoBOM

    $packageSuffix = if ($UnsignedDevelopmentOnly) { '_UNSIGNED_DEVELOPMENT_ONLY' } else { '' }
    $packageName = "COMPASS.PresenterBridge_${Version}_x64${packageSuffix}.msix"
    $packagePath = Join-Path $work $packageName
    $makeAppxOutput = & $makeAppx pack /d $packageRoot /p $packagePath /no 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "MakeAppx package creation failed: $($makeAppxOutput -join [Environment]::NewLine)"
    }

    $preflight = & "$PSScriptRoot/Test-PresenterStorePackage.ps1" -PackagePath $packagePath -MakeAppxPath $makeAppx -IdentityName $IdentityName -Publisher $Publisher -PublisherDisplayName $PublisherDisplayName -Version $Version -SourceCommit $SourceCommit -ExpectedStatus $buildStatus -ExpectedLicenseTermsMode $licenseTermsMode -ExpectedNoticeFiles $noticeFiles -ExpectedPublishedFilesManifestSha256 $publishedFilesManifestSha256
    if ($preflight.Status -cne 'STORE_PACKAGE_PREFLIGHT_PASS') { throw 'Store package preflight did not pass.' }

    $ready = Join-Path $output 'ready'
    $null = New-Item -ItemType Directory -Path $ready
    $readyPackage = Join-Path $ready $packageName
    Copy-Item -LiteralPath $packagePath -Destination $readyPackage
    $receipt = [pscustomobject]@{
        Status = $buildStatus
        GeneralDistributionAllowed = $false
        Package = $packageName
        PackageBytes = (Get-Item -LiteralPath $readyPackage).Length
        PackageSha256 = (Get-FileHash -LiteralPath $readyPackage -Algorithm SHA256).Hash.ToLowerInvariant()
        SourceCommit = $SourceCommit
        SourceCheckout = if ($dirty) { 'DIRTY_UNREVIEWED' } else { 'CLEAN_EXACT_COMMIT' }
        IdentityName = $IdentityName
        Publisher = $Publisher
        PublisherDisplayName = $PublisherDisplayName
        Version = $Version
        DotnetSdkVersion = $sdk
        MakeAppxVersion = $makeAppxVersion.ToString()
        MakeAppxSha256 = $makeAppxSha256
        PublishedFiles = $publishedFilesManifest.Count
        PublishedFilesManifestSha256 = $publishedFilesManifestSha256
        LicenseTermsMode = $licenseTermsMode
        AdditionalLicenseTermsSource = if ($additionalLicenseTerms) { $additionalLicenseTerms } else { $null }
        NoticeFiles = $noticeFiles
        PackagePreflight = $preflight.Status
        StoreSigning = 'NOT_YET_SIGNED: Microsoft Store certification/ingestion must sign this package before teacher distribution.'
        UpdateContinuityAcceptedMinimumOsBuild = 26100
        MinimumOsBuild = 26100
        DownlevelAcceptance = 'NOT_ELIGIBLE_V1_19041_TO_26099'
    }
    $receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $ready 'store-build-receipt.json') -Encoding utf8NoBOM
    $receipt
    if ($UnsignedDevelopmentOnly) {
        Write-Warning 'UNSIGNED_DEVELOPMENT_ONLY: this package is not for Partner Center upload, sideloading, or general distribution.'
    } else {
        Write-Warning 'Unsigned Partner Center submission input only. General distribution is prohibited until Microsoft Store certification and signing.'
    }
} finally {
    Pop-Location
}
