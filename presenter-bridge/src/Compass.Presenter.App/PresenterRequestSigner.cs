using System.Security.Cryptography;
using System.Text;

namespace Compass.Presenter.App;

internal sealed record PresenterRequestProofHeaders(
    string KeyId,
    string PublicKeySpki,
    string Timestamp,
    string Nonce,
    string Signature);

internal interface IPresenterRequestSigner
{
    string KeyId { get; }

    string PublicKeySpki { get; }

    PresenterRequestProofHeaders Sign(
        ReadOnlySpan<byte> body,
        DateTimeOffset? now = null,
        ReadOnlySpan<byte> nonce = default);
}

internal sealed class PresenterRequestSigner : IPresenterRequestSigner, IDisposable
{
    private const string SignatureContext = "compass-presenter-session-v1";
    private const string SignaturePath =
        "/functions/v1/presenter-bridge-session";
    private readonly ECDsa signer;
    private readonly bool ownsSigner;

    public PresenterRequestSigner(ECDsa signer, bool ownsSigner = true)
    {
        this.signer = signer ?? throw new ArgumentNullException(nameof(signer));
        this.ownsSigner = ownsSigner;
        var spki = signer.ExportSubjectPublicKeyInfo();
        try
        {
            PublicKeySpki = Base64UrlEncode(spki);
            KeyId = Convert.ToHexString(SHA256.HashData(spki)).ToLowerInvariant();
        }
        finally
        {
            CryptographicOperations.ZeroMemory(spki);
        }
    }

    public string KeyId { get; }

    public string PublicKeySpki { get; }

    public PresenterRequestProofHeaders Sign(
        ReadOnlySpan<byte> body,
        DateTimeOffset? now = null,
        ReadOnlySpan<byte> nonce = default)
    {
        byte[]? generatedNonce = null;
        if (nonce.IsEmpty)
        {
            generatedNonce = RandomNumberGenerator.GetBytes(24);
            nonce = generatedNonce;
        }
        if (nonce.Length is < 16 or > 64)
        {
            if (generatedNonce is not null)
            {
                CryptographicOperations.ZeroMemory(generatedNonce);
            }
            throw new ArgumentOutOfRangeException(nameof(nonce));
        }

        var timestamp = (now ?? DateTimeOffset.UtcNow)
            .ToUnixTimeSeconds()
            .ToString(System.Globalization.CultureInfo.InvariantCulture);
        var nonceText = Base64UrlEncode(nonce);
        var bodyHash = Convert.ToHexString(SHA256.HashData(body))
            .ToLowerInvariant();
        var canonical = string.Join(
            '\n',
            "v1",
            "POST",
            SignatureContext,
            SignaturePath,
            timestamp,
            nonceText,
            bodyHash);
        var canonicalBytes = Encoding.UTF8.GetBytes(canonical);
        byte[] signature;
        try
        {
            signature = signer.SignData(
                canonicalBytes,
                HashAlgorithmName.SHA256,
                DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(canonicalBytes);
            if (generatedNonce is not null)
            {
                CryptographicOperations.ZeroMemory(generatedNonce);
            }
        }
        try
        {
            if (signature.Length != 64)
            {
                throw new CryptographicException(
                    "Presenter proof signature has an invalid format.");
            }
            return new PresenterRequestProofHeaders(
                KeyId,
                PublicKeySpki,
                timestamp,
                nonceText,
                Base64UrlEncode(signature));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(signature);
        }
    }

    public void Dispose()
    {
        if (ownsSigner)
        {
            signer.Dispose();
        }
    }

    internal static byte[] BuildCanonicalForTest(
        ReadOnlySpan<byte> body,
        string timestamp,
        string nonce)
    {
        var bodyHash = Convert.ToHexString(SHA256.HashData(body))
            .ToLowerInvariant();
        return Encoding.UTF8.GetBytes(string.Join(
            '\n',
            "v1",
            "POST",
            SignatureContext,
            SignaturePath,
            timestamp,
            nonce,
            bodyHash));
    }

    internal static byte[] Base64UrlDecode(string value)
    {
        var normalized = value.Replace('-', '+').Replace('_', '/');
        normalized = normalized.PadRight(
            normalized.Length + ((4 - normalized.Length % 4) % 4),
            '=');
        return Convert.FromBase64String(normalized);
    }

    private static string Base64UrlEncode(ReadOnlySpan<byte> value) =>
        Convert.ToBase64String(value)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
}
