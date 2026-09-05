#requires -Version 7.4
[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+$')][string] $Version = '0.1.0',
    [Parameter(Mandatory)][string] $StagingRoot,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string] $SourceCommit,
    [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string] $CertificateThumbprint,
    [Parameter(Mandatory)][string] $ExpectedPublisherSubject,
    [Parameter(Mandatory)][string] $SignToolPath,
    [Parameter(Mandatory)][uri] $TimestampServer,
    [string] $DotnetPath = 'dotnet'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $PSScriptRoot
$stage = [IO.Path]::GetFullPath($StagingRoot)
if (Test-Path -LiteralPath $stage) { throw 'StagingRoot must be new; existing release files are never overwritten.' }
$tool = (Resolve-Path -LiteralPath $SignToolPath).Path
$shell = (Get-Process -Id $PID).Path
$signer = Join-Path $PSScriptRoot 'Sign-PresenterFile.ps1'
# These values enter vpk's process template. Refuse quote/newline/template injection.
foreach ($value in @($stage, $tool, $shell, $signer, $ExpectedPublisherSubject, $TimestampServer.AbsoluteUri)) {
    if ($value -match '["\r\n{}%!]') { throw 'An unsafe signing-template value was supplied.' }
}
$certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$CertificateThumbprint"
if (!$certificate.HasPrivateKey -or $certificate.Subject -cne $ExpectedPublisherSubject) {
    throw 'The approved CSP code-signing certificate is not available.'
}
function Invoke-Dotnet([string[]] $Arguments) {
    & $DotnetPath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "dotnet $($Arguments[0]) failed." }
}
Push-Location $bridgeRoot
try {
    $head = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $head -cne $SourceCommit) { throw 'SourceCommit must equal checkout HEAD.' }
    $dirty = & git status --porcelain --untracked-files=all
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'A clean reviewed source checkout is required.' }
    $manifest = Get-Content -Raw -LiteralPath '.config/dotnet-tools.json' | ConvertFrom-Json
    if ($manifest.tools.vpk.version -cne '1.2.0') { throw 'Only vpk 1.2.0 is approved.' }
    $sdk = (& $DotnetPath --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $sdk -notmatch '^10\.0\.30\d+$') { throw 'The pinned .NET 10.0.302 feature band is required.' }
    $null = New-Item -ItemType Directory -Path $stage
    $publish = Join-Path $stage 'work/publish'
    $packed = Join-Path $stage 'work/packed'
    Invoke-Dotnet @('tool', 'restore')
    Invoke-Dotnet @('restore', 'src/Compass.Presenter.App/Compass.Presenter.App.csproj', '--runtime', 'win-x64', '--locked-mode', '-p:SelfContained=true')
    Invoke-Dotnet @('publish', 'src/Compass.Presenter.App/Compass.Presenter.App.csproj', '--configuration', 'Release', '--runtime', 'win-x64', '--self-contained', 'true', '--no-restore', '-p:PlatformTarget=x64', "-p:Version=$Version", '--output', $publish)
    # vpk 1.2.0 CodeSign.QuoteFileArgsWindows quotes {{file}} before replacement.
    # Keep this placeholder bare to avoid double quoting a path containing spaces.
    $template = '"{0}" -NoLogo -NoProfile -File "{1}" -CertificateThumbprint {2} -ExpectedPublisherSubject "{3}" -SignToolPath "{4}" -TimestampServer "{5}" -FilePath {{{{file}}}}' -f $shell, $signer, $CertificateThumbprint, $ExpectedPublisherSubject, $tool, $TimestampServer.AbsoluteUri
    Invoke-Dotnet @('tool', 'run', 'vpk', '--', 'pack', '--packId', 'CompassPresenterBridge', '--packVersion', $Version, '--packDir', $publish, '--mainExe', 'COMPASS.PresenterBridge.exe', '--packTitle', 'COMPASS Presenter Bridge', '--packAuthors', 'COMPASS', '--runtime', 'win-x64', '--channel', 'win-x64', '--shortcuts', 'Startup,StartMenuRoot', '--instLocation', 'PerUser', '--delta', 'None', '--noPortable', '--signParallel', '1', '--signTemplate', $template, '--outputDir', $packed, '--skip-updates')
    $setups = @(Get-ChildItem -LiteralPath $packed -File -Filter '*Setup.exe')
    $packages = @(Get-ChildItem -LiteralPath $packed -File -Filter '*-full.nupkg')
    if ($setups.Count -ne 1 -or $packages.Count -ne 1) { throw 'Expected one Setup and one full package.' }
    $setup = $setups[0]
    $package = $packages[0]
    if ($package.Length -gt 256MB) { throw 'The package exceeds the native download limit.' }
    $evidence = [Collections.Generic.List[object]]::new()
    $evidence.Add((& "$PSScriptRoot/Assert-PresenterSignature.ps1" -FilePath $setup.FullName -ExpectedPublisherSubject $ExpectedPublisherSubject))
    $extracted = Join-Path $stage 'work/verify-package'
    [IO.Compression.ZipFile]::ExtractToDirectory($package.FullName, $extracted)
    $images = @(Get-ChildItem -LiteralPath $extracted -Recurse -File | Where-Object { $_.Extension -in @('.exe', '.dll') })
    if (!($images | Where-Object Name -eq 'COMPASS.PresenterBridge.exe') -or !($images | Where-Object Name -eq 'Update.exe')) {
        throw 'The packaged bridge or updater is missing.'
    }
    foreach ($file in $images) {
        $owned = $file.Name -match '^(Compass\.|COMPASS\.|Update\.exe$|Velopack\.dll$)'
        $evidence.Add((& "$PSScriptRoot/Assert-PresenterSignature.ps1" -FilePath $file.FullName -ExpectedPublisherSubject $ExpectedPublisherSubject -AllowOriginalPublisher:(!$owned)))
    }
    foreach ($item in $evidence) {
        $item.File = [IO.Path]::GetRelativePath($stage, $item.File).Replace('\', '/')
    }
    $null = & "$PSScriptRoot/New-PresenterPackageSignature.ps1" -FilePath $package.FullName -CertificateThumbprint $CertificateThumbprint -ExpectedPublisherSubject $ExpectedPublisherSubject
    $indexPath = Join-Path $packed 'releases.win-x64.json'
    $index = Get-Content -LiteralPath $indexPath -Raw | ConvertFrom-Json
    $assets = @($index.Assets)
    $packageHash = (Get-FileHash -LiteralPath $package.FullName -Algorithm SHA256).Hash
    if ($assets.Count -ne 1 -or $assets[0].PackageId -cne 'CompassPresenterBridge' -or
        $assets[0].Version -cne $Version -or $assets[0].Type -cne 'Full' -or
        $assets[0].FileName -cne $package.Name -or $assets[0].Size -ne $package.Length -or
        $assets[0].SHA256 -ine $packageHash) { throw 'The release index does not match the signed full package.' }
    # Only this directory may be uploaded. All checks finish before it is created.
    $ready = Join-Path $stage 'ready'
    $feed = Join-Path $ready 'feed'
    $immutable = Join-Path $ready "versions/$Version"
    $null = New-Item -ItemType Directory -Path $feed, $immutable
    $setupName = "CompassPresenterBridge-$Version-win-x64-Setup.exe"
    Copy-Item -LiteralPath $setup.FullName -Destination (Join-Path $immutable $setupName)
    foreach ($file in @($package.FullName, ($package.FullName + '.p7s'))) {
        Copy-Item -LiteralPath $file -Destination $feed
        Copy-Item -LiteralPath $file -Destination $immutable
    }
    Copy-Item -LiteralPath $indexPath -Destination $feed
    $files = @(Get-ChildItem -LiteralPath $ready -Recurse -File | ForEach-Object {
        [pscustomobject]@{ Path = [IO.Path]::GetRelativePath($ready, $_.FullName).Replace('\', '/'); Bytes = $_.Length; Sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
    [pscustomobject]@{
        Status = 'SIGNATURE_VERIFIED'; SourceCommit = $SourceCommit; Version = $Version
        PackageId = 'CompassPresenterBridge'; Channel = 'win-x64'; Runtime = 'win-x64'
        InstallerUrl = "https://presenter-updates.yuto-matsui.com/versions/$Version/$setupName"
        Publisher = $ExpectedPublisherSubject; CertificateThumbprint = $CertificateThumbprint
        PackageSignatureExpiresAt = $certificate.NotAfter.ToUniversalTime().ToString('O')
        PackageSignaturePolicy = 'Detached CMS SHA256; current-time trusted code-signing chain; same installed publisher'
        Files = $files; ExecutableSignatures = $evidence
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $ready 'release-manifest.json') -Encoding utf8NoBOM
    Write-Output "Verified staging only: $ready. Upload payloads and .p7s first; publish releases.win-x64.json last."
} finally { Pop-Location }
