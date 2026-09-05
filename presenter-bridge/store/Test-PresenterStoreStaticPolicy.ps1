#requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Contains([string] $Path, [string] $Pattern, [string] $Label) {
    $text = Get-Content -Raw -LiteralPath $Path
    if ($text -notmatch $Pattern) { throw "Store static policy is missing: $Label" }
}

function Assert-Excludes([string] $Path, [string] $Pattern, [string] $Label) {
    $text = Get-Content -Raw -LiteralPath $Path
    if ($text -match $Pattern) { throw "Store static policy contains prohibited content: $Label" }
}

$build = Join-Path $PSScriptRoot 'Build-PresenterStorePackage.ps1'
$buildPolicyTest = Join-Path $PSScriptRoot 'Test-PresenterStoreBuildPolicy.ps1'
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ciWorkflow = Join-Path $repositoryRoot '.github/workflows/ci.yml'
$productionWorkflow = Join-Path $repositoryRoot '.github/workflows/presenter-store-package.yml'
$pullRequestTemplate = Join-Path $repositoryRoot '.github/pull_request_template.md'
$localBuild = Join-Path $PSScriptRoot 'New-PresenterStoreLocalDeviceTestPackage.ps1'
$localTest = Join-Path $PSScriptRoot 'Test-PresenterStoreLocalDeviceTestPackage.ps1'
$notice = Join-Path $PSScriptRoot 'COMPASS-BINARY-NOTICE.txt'
$readme = Join-Path $PSScriptRoot 'README.md'
$packageTest = Join-Path $PSScriptRoot 'Test-PresenterStorePackage.ps1'

$buildText = Get-Content -Raw -LiteralPath $build
$packageTestText = Get-Content -Raw -LiteralPath $packageTest
foreach ($forbidden in @(
    'AdditionalLicenseTermsFileName',
    'AdditionalLicenseTermsSha256',
    'ADDITIONAL_LICENSE_TERMS',
    'TermsPackagePath'
)) {
    if ($buildText -match [regex]::Escape($forbidden) -or
        $packageTestText -match [regex]::Escape($forbidden)) {
        throw "Version 1 Store code retains a forbidden additional-terms mode or package field: $forbidden"
    }
}
Assert-Contains $build 'AdditionalLicenseTermsPath is prohibited for the version 1 Store package' 'explicit additional-terms rejection'
Assert-Contains $build 'UNSIGNED_DEVELOPMENT_ONLY builds must not attest to Microsoft Standard Application License Terms' 'development-only terms rejection'
Assert-Contains $build 'UseMicrosoftStandardApplicationLicenseTerms is required for every version 1 Partner Center submission input' 'production Standard terms requirement'
Assert-Contains $build 'StorePathCanonicalizerV1' 'physical Windows path canonicalization'
Assert-Contains $build 'device and network path aliases are prohibited' 'device and network path rejection'
Assert-Contains $build 'mapped network drives and network reparse targets are prohibited' 'physical network target rejection'
Assert-Contains $build 'path aliases and reparse points cannot bypass release isolation' 'physical checkout boundary'
Assert-Contains $build 'The new path is intentionally left intact because deleting an untrusted replacement could affect another target' 'TOCTOU mismatch non-destructive handling'
Assert-Contains $build 'OutputRoot is too long for deterministic Windows package tooling' 'legacy Windows path-limit fail-fast'
Assert-Contains $build '\$sdkPolicy\.sdk\.rollForward -cne ''latestPatch''' 'global.json SDK roll-forward policy'
Assert-Contains $build '\$actualFeatureBand -ne \$requestedFeatureBand' 'SDK feature-band match'
Assert-Contains $build '\$actualSdkVersion\.Build -lt \$requestedSdkVersion\.Build' 'SDK minimum patch match'
Assert-Excludes $build '\^10\\\.0\\\.30\\d' 'ambiguous SDK version regex'
Assert-Contains $build '\$dotnetArtifacts\s*=\s*Join-Path \$work ''dotnet-artifacts''' 'isolated .NET artifacts root'
Assert-Contains $build '\$restorePackages\s*=\s*Join-Path \$work ''nuget-packages''' 'isolated restore packages root'
Assert-Contains $build '''--artifacts-path'', \$dotnetArtifacts' 'SDK artifacts-path isolation'
Assert-Contains $build '"-p:RestorePackagesPath=\$restorePackages"' 'isolated NuGet package property'
Assert-Contains $build '(?s)\$restoreArguments\s*=\s*@\(.*?\)\s*\+\s*\$isolatedBuildArguments' 'restore isolation arguments'
Assert-Contains $build '(?s)\$publishArguments\s*=\s*@\(.*?\)\s*\+\s*\$isolatedBuildArguments' 'publish isolation arguments'
Assert-Contains $build '''--disable-build-servers''' 'persistent build-server isolation'
Assert-Contains $build 'BuildIsolation\s*=\s*''NEW_OUTPUT_ROOT_ONLY''' 'receipt build-isolation marker'
Assert-Contains $build 'OutputRootBoundary\s*=\s*''NORMAL_LOCAL_DRIVE_PHYSICALLY_OUTSIDE_CHECKOUT''' 'receipt physical output-boundary marker'
Assert-Contains $buildPolicyTest 'STORE_DEVICE_PATH_ALIAS_REJECT' 'device path negative test'
Assert-Contains $buildPolicyTest 'STORE_NETWORK_PATH_ALIAS_REJECT' 'network path negative test'
Assert-Contains $buildPolicyTest 'STORE_REPARSE_CHECKOUT_ALIAS_REJECT' 'reparse checkout negative test'
Assert-Contains $buildPolicyTest 'STORE_SDK_FEATURE_BAND_REJECT' 'SDK feature-band negative test'
Assert-Contains $buildPolicyTest 'STORE_SDK_MINIMUM_PATCH_REJECT' 'SDK minimum patch negative test'
Assert-Contains $buildPolicyTest 'STORE_SDK_LATEST_PATCH_POLICY_ACCEPT' 'SDK latest-patch acceptance test'
Assert-Contains $buildPolicyTest 'Refusing to recursively clean a Store builder policy path that contains a reparse point' 'policy-test physical cleanup boundary'
Assert-Contains $packageTest 'Build isolation status' 'package preflight build-isolation check'
Assert-Contains $packageTest 'Output root boundary' 'package preflight physical output-boundary check'
Assert-Contains $readme 'device and network aliases' 'documented device and network alias rejection'
Assert-Contains $readme 'NORMAL_LOCAL_DRIVE_PHYSICALLY_OUTSIDE_CHECKOUT' 'documented physical output-boundary receipt'
Assert-Contains $ciWorkflow 'COMPASS_STORE_ISOLATION_SENTINEL_ASSETS' 'poisoned checkout obj isolation proof'
Assert-Contains $ciWorkflow 'COMPASS_STORE_ISOLATION_SENTINEL_BINARY' 'poisoned checkout bin isolation proof'
Assert-Contains $ciWorkflow "BuildIsolation -cne 'NEW_OUTPUT_ROOT_ONLY'" 'CI build-isolation receipt check'
Assert-Contains $ciWorkflow "OutputRootBoundary -cne 'NORMAL_LOCAL_DRIVE_PHYSICALLY_OUTSIDE_CHECKOUT'" 'CI physical output-boundary receipt check'
Assert-Contains $ciWorkflow 'Test-PresenterStoreBuildPolicy\.ps1' 'CI Store builder policy tests'
Assert-Contains $packageTest 'The expected license-terms mode does not match the Store build status' 'preflight status/license coupling'
Assert-Contains $productionWorkflow 'workflow_dispatch:' 'manual production package dispatch'
Assert-Contains $productionWorkflow "github\.ref.*refs/heads/main" 'reviewed default-branch restriction'
Assert-Contains $productionWorkflow 'source_commit:' 'exact reviewed source input'
Assert-Contains $productionWorkflow "github\.sha.*STORE_SOURCE_COMMIT" 'dispatch SHA binding'
Assert-Contains $productionWorkflow 'sourceCommit -cne \$env:STORE_SOURCE_COMMIT' 'checkout SHA binding'
Assert-Contains $productionWorkflow 'PartnerCenterIdentityConfirmed' 'reserved Partner Center identity confirmation'
Assert-Contains $productionWorkflow 'UseMicrosoftStandardApplicationLicenseTerms' 'fixed Microsoft Standard terms selection'
Assert-Contains $productionWorkflow "Status -cne 'PARTNER_CENTER_SUBMISSION_INPUT_UNSIGNED'" 'submission-only receipt status check'
Assert-Contains $productionWorkflow 'GeneralDistributionAllowed -ne \$false' 'general-distribution receipt check'
Assert-Contains $productionWorkflow "BuildIsolation -cne 'NEW_OUTPUT_ROOT_ONLY'" 'workflow build-isolation receipt check'
Assert-Contains $productionWorkflow "OutputRootBoundary -cne 'NORMAL_LOCAL_DRIVE_PHYSICALLY_OUTSIDE_CHECKOUT'" 'workflow physical output-boundary receipt check'
Assert-Contains $productionWorkflow 'Test-PresenterStoreBuildPolicy\.ps1' 'workflow Store builder policy tests'
Assert-Contains $productionWorkflow 'no package is uploaded from this public workflow' 'public artifact prohibition'
Assert-Excludes $productionWorkflow 'UnsignedDevelopmentOnly' 'development package mode in production workflow'
Assert-Excludes $productionWorkflow 'AdditionalLicenseTermsPath' 'additional terms in production workflow'
Assert-Excludes $productionWorkflow 'actions/upload-artifact' 'public unsigned package artifact upload'
Assert-Contains $pullRequestTemplate 'Exact-SHA Store builder / package preflight' 'Store exact-source PR gate'
Assert-Contains $pullRequestTemplate 'Partner Center identity / WACK / certification / Store signing' 'Store certification PR gate'
Assert-Contains $pullRequestTemplate 'Store acquisition / update / repair / uninstall / rollback' 'Store lifecycle PR gate'
Assert-Contains $pullRequestTemplate 'no added Microsoft-account sign-in' 'Store no-added-auth PR gate'
Assert-Excludes $pullRequestTemplate 'Signed installer / SmartScreen / update / rollback' 'superseded Direct Presenter PR gate'
foreach ($path in @($localBuild, $localTest, $notice, $readme)) {
    Assert-Contains $path 'SIGNED_LOCAL_DEVICE_TEST_ONLY' "local-device-only marker in $([IO.Path]::GetFileName($path))"
}
Assert-Contains $localBuild 'PartnerCenterUploadAllowed\s*=\s*\$false' 'Partner Center upload prohibition'
Assert-Contains $localBuild 'StoreSubmissionAllowed\s*=\s*\$false' 'Store submission prohibition'
Assert-Contains $localBuild 'LocalDeviceTestOnly\s*=\s*\$true' 'local-device-only receipt flag'
Assert-Contains $localBuild 'GeneralDistributionAllowed\s*=\s*\$false' 'general-distribution prohibition'
Assert-Contains $localBuild 'SignatureDigestAlgorithm\s*=\s*''SHA256''' 'SHA-256 signature evidence'
Assert-Contains $localBuild 'SourcePackageSha256' 'source package hash evidence'
Assert-Contains $localBuild 'CertificateThumbprint' 'certificate thumbprint evidence'
Assert-Contains $localBuild 'OutputRoot must be outside the source checkout' 'external output boundary'
Assert-Contains $localBuild 'OutputRoot must be new' 'non-overwrite output boundary'
Assert-Contains $localBuild '_UNSIGNED_DEVELOPMENT_ONLY\\\.msix' 'unsigned development source restriction'
Assert-Contains $localBuild 'Certificate\.HasPrivateKey' 'certificate private-key check'
Assert-Contains $localBuild 'Certificate\.Subject -cne \$Publisher' 'certificate Publisher match'
Assert-Contains $localBuild 'Certificate\.NotBefore -gt \$now' 'certificate start-validity check'
Assert-Contains $localBuild 'Certificate\.NotAfter -le \$now' 'certificate expiry check'
Assert-Contains $localBuild '/fd SHA256' 'SHA-256 SignTool command'
Assert-Contains $localBuild 'SourcePackage = \[IO\.Path\]::GetFileName\(\$source\)' 'source path excluded from receipt'
Assert-Contains $localBuild 'SignedPackage = \$signedName' 'signed path excluded from receipt'
Assert-Contains $localTest 'AppxSignature\.p7x' 'signed package signature presence check'
Assert-Contains $localTest 'Code Signing EKU' 'Code Signing EKU check'
Assert-Contains $localTest 'Get-AuthenticodeSignature -LiteralPath \$signed' 'Authenticode package verification'
Assert-Contains $localTest 'verify /pa /all \$signed' 'SignTool package verification'
Assert-Contains $localTest 'Certificate\.Thumbprint -ine \$thumbprint' 'certificate thumbprint match'
Assert-Contains $localTest 'Signing changed package payload content' 'payload identity verification'

'STORE_STATIC_POLICY_PASS'
