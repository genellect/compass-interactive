#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $MakeAppxPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$builder = Join-Path $PSScriptRoot 'Build-PresenterStorePackage.ps1'
$bridgeRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = [IO.Path]::GetFullPath((Split-Path -Parent $bridgeRoot))
$sourceCommit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[a-f0-9]{40}$') {
    throw 'Unable to resolve the exact source commit for Store builder policy tests.'
}

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
)
$scratch = Join-Path $tempRoot ("cps-$([Guid]::NewGuid().ToString('N').Substring(0, 8))")
if (!$scratch.StartsWith($tempRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The Store builder policy scratch path escaped the system temporary directory.'
}
$null = New-Item -ItemType Directory -Path $scratch

function Invoke-BuilderExpectedFailure(
    [string] $Label,
    [string] $OutputRoot,
    [string] $ExpectedMessage,
    [string] $DotnetPath,
    [string] $PackagerPath
) {
    $completed = $false
    $failure = $null
    try {
        & $builder `
            -Version '1.0.0.0' `
            -OutputRoot $OutputRoot `
            -SourceCommit $sourceCommit `
            -IdentityName 'CompassPresenterBridge.Development' `
            -Publisher 'CN=COMPASS Presenter Bridge Development' `
            -PublisherDisplayName 'COMPASS Development' `
            -MakeAppxPath $PackagerPath `
            -DotnetPath $DotnetPath `
            -UnsignedDevelopmentOnly `
            -AllowDirtyDevelopmentCheckout | Out-Null
        $completed = $true
    } catch {
        $failure = $_.Exception.Message
    }
    if ($completed) {
        throw "$Label unexpectedly completed."
    }
    if ($failure -notlike "*$ExpectedMessage*") {
        throw "$Label failed for the wrong reason: $failure"
    }
    "${Label}_PASS"
}

try {
    $missingTool = Join-Path $scratch 'must-not-run.exe'
    $deviceOutput = "\\?\$repositoryRoot\.presenter-store-device-path-negative"
    Invoke-BuilderExpectedFailure `
        'STORE_DEVICE_PATH_ALIAS_REJECT' `
        $deviceOutput `
        'device and network path aliases are prohibited' `
        $missingTool `
        $missingTool

    $networkOutput = '\\server.invalid\compass-presenter-store\negative'
    Invoke-BuilderExpectedFailure `
        'STORE_NETWORK_PATH_ALIAS_REJECT' `
        $networkOutput `
        'device and network path aliases are prohibited' `
        $missingTool `
        $missingTool

    $junction = Join-Path $scratch 'checkout-link'
    $null = New-Item -ItemType Junction -Path $junction -Target $repositoryRoot
    try {
        Invoke-BuilderExpectedFailure `
            'STORE_REPARSE_CHECKOUT_ALIAS_REJECT' `
            (Join-Path $junction '.presenter-store-junction-negative') `
            'path aliases and reparse points cannot bypass release isolation' `
            $missingTool `
            $missingTool
    } finally {
        if (Test-Path -LiteralPath $junction) {
            Remove-Item -LiteralPath $junction -Force
        }
    }

    $longOutput = Join-Path $scratch ('x' * 180)
    Invoke-BuilderExpectedFailure `
        'STORE_LONG_OUTPUT_ROOT_FAIL_FAST' `
        $longOutput `
        'OutputRoot is too long for deterministic Windows package tooling' `
        $missingTool `
        $missingTool

    $fakeDotnetRoot = Join-Path $scratch 'fake-dotnet'
    $null = New-Item -ItemType Directory -Path $fakeDotnetRoot
    Set-Content -LiteralPath (Join-Path $fakeDotnetRoot 'LICENSE.txt') -Value 'policy-test license' -Encoding utf8NoBOM
    Set-Content -LiteralPath (Join-Path $fakeDotnetRoot 'ThirdPartyNotices.txt') -Value 'policy-test notices' -Encoding utf8NoBOM
    $fakeDotnet = Join-Path $fakeDotnetRoot 'dotnet.cmd'

    foreach ($case in @(
        @{ Label = 'STORE_SDK_MAJOR_REJECT'; Version = '9.0.302' },
        @{ Label = 'STORE_SDK_MINOR_REJECT'; Version = '10.1.302' },
        @{ Label = 'STORE_SDK_FEATURE_BAND_REJECT'; Version = '10.0.402' },
        @{ Label = 'STORE_SDK_MINIMUM_PATCH_REJECT'; Version = '10.0.301' }
    )) {
        Set-Content -LiteralPath $fakeDotnet -Value "@echo $($case.Version)" -Encoding ascii
        $caseOutput = Join-Path $scratch $case.Label.ToLowerInvariant()
        Invoke-BuilderExpectedFailure `
            $case.Label `
            $caseOutput `
            'latestPatch feature band is required' `
            $fakeDotnet `
            $MakeAppxPath
        if (Test-Path -LiteralPath $caseOutput) {
            throw "$($case.Label) created OutputRoot before rejecting the SDK."
        }
    }

    Set-Content -LiteralPath $fakeDotnet -Value @'
@if "%~1"=="--version" (
  @echo 10.0.399
  @exit /b 0
)
@exit /b 37
'@ -Encoding ascii
    $latestPatchOutput = Join-Path $scratch 'store-sdk-latest-patch-accept'
    Invoke-BuilderExpectedFailure `
        'STORE_SDK_LATEST_PATCH_POLICY_ACCEPT' `
        $latestPatchOutput `
        'dotnet restore failed' `
        $fakeDotnet `
        $MakeAppxPath

    'STORE_BUILD_POLICY_TESTS_PASS'
} finally {
    if (Test-Path -LiteralPath $scratch) {
        $trimSeparators = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
        $physicalTemp = [Compass.Presenter.StorePathCanonicalizerV1]::ResolveExistingDirectory($tempRoot).TrimEnd($trimSeparators)
        $physicalScratch = [Compass.Presenter.StorePathCanonicalizerV1]::ResolveExistingDirectory($scratch).TrimEnd($trimSeparators)
        if (!$physicalScratch.StartsWith($physicalTemp + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Refusing to clean a Store builder policy path outside the system temporary directory.'
        }
        $reparseItems = @(@(
                Get-Item -LiteralPath $scratch -Force
                Get-ChildItem -LiteralPath $scratch -Recurse -Force
            ) | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 })
        if ($reparseItems.Count -ne 0) {
            throw 'Refusing to recursively clean a Store builder policy path that contains a reparse point.'
        }
        Remove-Item -LiteralPath $scratch -Recurse -Force
    }
}
