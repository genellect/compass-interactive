#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $FilePath,
    [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string] $CertificateThumbprint,
    [Parameter(Mandatory)][string] $ExpectedPublisherSubject
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$file = (Resolve-Path -LiteralPath $FilePath).Path
$output = $file + '.p7s'
if (Test-Path -LiteralPath $output) { throw 'A package signature already exists.' }
$certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$CertificateThumbprint"
if (!$certificate.HasPrivateKey -or $certificate.Subject -cne $ExpectedPublisherSubject) {
    throw 'The approved CSP code-signing certificate is not available.'
}
$chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
try {
    $chain.ChainPolicy.ApplicationPolicy.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3'))
    $chain.ChainPolicy.RevocationMode = 'Online'
    $chain.ChainPolicy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(3)
    if (!$chain.Build($certificate)) { throw 'The package signing certificate is not currently trusted.' }
} finally { $chain.Dispose() }
$content = [Security.Cryptography.Pkcs.ContentInfo]::new([IO.File]::ReadAllBytes($file))
$cms = [Security.Cryptography.Pkcs.SignedCms]::new($content, $true)
$signer = [Security.Cryptography.Pkcs.CmsSigner]::new($certificate)
$signer.DigestAlgorithm = [Security.Cryptography.Oid]::new('2.16.840.1.101.3.4.2.1')
$signer.IncludeOption = 'ExcludeRoot'
# Uses the existing CSP private key. No key is generated, exported or written.
$cms.ComputeSignature($signer, $false)
$cms.CheckSignature($false)
$bytes = $cms.Encode()
if ($bytes.Length -gt 256KB) { throw 'The detached package signature exceeds the client limit.' }
[IO.File]::WriteAllBytes($output, $bytes)
Get-Item -LiteralPath $output
