#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $FilePath,
    [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string] $CertificateThumbprint,
    [Parameter(Mandatory)][string] $ExpectedPublisherSubject,
    [Parameter(Mandatory)][string] $SignToolPath,
    [Parameter(Mandatory)][uri] $TimestampServer
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($TimestampServer.Scheme -notin @('http', 'https') -or $TimestampServer.UserInfo -or
    $TimestampServer.Query -or $TimestampServer.Fragment) { throw 'Invalid timestamp service URI.' }
$tool = (Resolve-Path -LiteralPath $SignToolPath).Path
$file = (Resolve-Path -LiteralPath $FilePath).Path
$certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$CertificateThumbprint"
if (!$certificate.HasPrivateKey -or $certificate.Subject -cne $ExpectedPublisherSubject) {
    throw 'The approved CSP code-signing certificate is not available.'
}
& $tool sign /s My /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampServer.AbsoluteUri /td SHA256 $file
if ($LASTEXITCODE -ne 0) { throw 'Authenticode signing failed.' }
& "$PSScriptRoot/Assert-PresenterSignature.ps1" -FilePath $file -ExpectedPublisherSubject $ExpectedPublisherSubject | Out-Null
