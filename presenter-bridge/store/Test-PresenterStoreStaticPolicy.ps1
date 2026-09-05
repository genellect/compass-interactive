#requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Contains([string] $Path, [string] $Pattern, [string] $Label) {
    $text = Get-Content -Raw -LiteralPath $Path
    if ($text -notmatch $Pattern) { throw "Store static policy is missing: $Label" }
}

$build = Join-Path $PSScriptRoot 'Build-PresenterStorePackage.ps1'
$localBuild = Join-Path $PSScriptRoot 'New-PresenterStoreLocalDeviceTestPackage.ps1'
$localTest = Join-Path $PSScriptRoot 'Test-PresenterStoreLocalDeviceTestPackage.ps1'
$notice = Join-Path $PSScriptRoot 'COMPASS-BINARY-NOTICE.txt'
$readme = Join-Path $PSScriptRoot 'README.md'

if ((Get-Content -Raw -LiteralPath $build) -match 'AdditionalLicenseTermsSource') {
    throw 'Store receipts must not retain the absolute AdditionalLicenseTerms source path.'
}
Assert-Contains $build 'AdditionalLicenseTermsFileName' 'additional terms basename receipt'
Assert-Contains $build 'AdditionalLicenseTermsSha256' 'additional terms SHA-256 receipt'
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
