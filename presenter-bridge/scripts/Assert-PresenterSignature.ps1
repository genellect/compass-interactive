#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $FilePath,
    [Parameter(Mandatory)][string] $ExpectedPublisherSubject,
    [switch] $AllowOriginalPublisher
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path -LiteralPath $FilePath).Path
$signature = Get-AuthenticodeSignature -LiteralPath $resolved
if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
    $null -eq $signature.TimeStamperCertificate) {
    throw "A trusted, timestamped Authenticode signature is required: $resolved"
}
if (!$AllowOriginalPublisher -and
    $signature.SignerCertificate.Subject -cne $ExpectedPublisherSubject) {
    throw "The approved release publisher did not sign: $resolved"
}

# Validate the embedded Authenticode content digest, not the certificate's own
# signature algorithm. Catalog-only signatures do not satisfy this release gate.
function Read-DerValue([byte[]] $Bytes, [ref] $Offset, [byte] $Tag) {
    $position = [int] $Offset.Value
    if ($position + 2 -gt $Bytes.Length -or $Bytes[$position++] -ne $Tag) {
        throw 'Unsupported Authenticode DER value.'
    }
    [long] $length = $Bytes[$position++]
    if ($length -ge 128) {
        $count = [int] ($length -band 127)
        if ($count -lt 1 -or $count -gt 4 -or $position + $count -gt $Bytes.Length) {
            throw 'Invalid Authenticode DER length.'
        }
        $length = 0
        for ($index = 0; $index -lt $count; $index++) {
            $length = ($length -shl 8) -bor $Bytes[$position++]
        }
    }
    if ($length -gt $Bytes.Length - $position) { throw 'Truncated Authenticode DER.' }
    $Offset.Value = [int] ($position + $length)
    return ,([byte[]] $Bytes[$position..([int] ($position + $length - 1))])
}

$stream = [IO.File]::OpenRead($resolved)
$reader = [IO.BinaryReader]::new($stream)
try {
    $stream.Position = 0x3c
    $peOffset = $reader.ReadUInt32()
    $stream.Position = $peOffset
    if ($reader.ReadUInt32() -ne 0x4550) { throw 'Expected a PE image.' }
    $optionalHeader = $peOffset + 24
    $stream.Position = $optionalHeader
    $magic = $reader.ReadUInt16()
    $directoryOffset = switch ($magic) { 0x10b { 96 }; 0x20b { 112 }; default { throw 'Unknown PE image.' } }
    $stream.Position = $optionalHeader + $directoryOffset + 32
    $certificateOffset = $reader.ReadUInt32()
    $certificateLength = $reader.ReadUInt32()
    if ($certificateOffset -eq 0 -or $certificateLength -lt 8 -or
        $certificateLength -gt 16MB -or
        [long] $certificateOffset + $certificateLength -gt $stream.Length) {
        throw 'Missing or invalid embedded PE signature.'
    }
    $stream.Position = $certificateOffset
    $length = $reader.ReadUInt32()
    $revision = $reader.ReadUInt16()
    $type = $reader.ReadUInt16()
    if ($revision -ne 0x200 -or $type -ne 2 -or $length -lt 8 -or $length -gt $certificateLength) {
        throw 'Unsupported embedded PE signature.'
    }
    $cms = [Security.Cryptography.Pkcs.SignedCms]::new()
    $cms.Decode($reader.ReadBytes([int] $length - 8))
    $sha256Oid = '2.16.840.1.101.3.4.2.1'
    if ($cms.SignerInfos.Count -ne 1 -or $cms.SignerInfos[0].DigestAlgorithm.Value -ne $sha256Oid) {
        throw 'A single SHA-256 Authenticode signer is required.'
    }
    $timestamp = @($cms.SignerInfos[0].UnsignedAttributes | Where-Object {
        $_.Oid.Value -in @('1.3.6.1.4.1.311.3.3.1', '1.2.840.113549.1.9.16.2.14')
    })
    if ($timestamp.Count -ne 1) { throw 'An RFC 3161 timestamp is required.' }
    $position = 0
    $indirect = Read-DerValue $cms.ContentInfo.Content ([ref] $position) 0x30
    $position = 0
    $null = Read-DerValue $indirect ([ref] $position) 0x30
    $digestInfo = Read-DerValue $indirect ([ref] $position) 0x30
    $position = 0
    $algorithm = Read-DerValue $digestInfo ([ref] $position) 0x30
    $digest = Read-DerValue $digestInfo ([ref] $position) 0x04
    $algorithmOffset = 0
    $oid = Read-DerValue $algorithm ([ref] $algorithmOffset) 0x06
    if ([Convert]::ToHexString($oid) -ne '608648016503040201' -or $digest.Length -ne 32) {
        throw 'The Authenticode file digest must be SHA-256.'
    }
} finally {
    $reader.Dispose()
    $stream.Dispose()
}

[pscustomobject]@{
    File = $resolved
    Sha256 = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
    Publisher = $signature.SignerCertificate.Subject
    CertificateThumbprint = $signature.SignerCertificate.Thumbprint
    TimestampPublisher = $signature.TimeStamperCertificate.Subject
    FileDigest = 'SHA256'
    Timestamp = 'RFC3161'
    Trust = 'Valid'
}
