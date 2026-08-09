using System.Runtime.Versioning;
using System.Security.Cryptography;

namespace Compass.Presenter.App;

[SupportedOSPlatform("windows10.0.19041")]
internal sealed class WindowsInstallationProof : IPresenterRequestSigner, IDisposable
{
    private const string KeyName =
        "COMPASS Interactive/PresenterBridge/Proof/v1";
    private static readonly CngProvider Provider =
        CngProvider.MicrosoftSoftwareKeyStorageProvider;
    private readonly CngKey key;
    private readonly PresenterRequestSigner signer;

    private WindowsInstallationProof(CngKey key)
    {
        this.key = key;
        signer = new PresenterRequestSigner(new ECDsaCng(key));
    }

    public string KeyId => signer.KeyId;

    public string PublicKeySpki => signer.PublicKeySpki;

    public static WindowsInstallationProof GetOrCreate() => GetOrCreate(KeyName);

    internal static WindowsInstallationProof GetOrCreate(string keyName)
    {
        ValidateKeyName(keyName);
        CngKey? key = null;
        try
        {
            if (CngKey.Exists(keyName, Provider, CngKeyOpenOptions.UserKey))
            {
                key = CngKey.Open(keyName, Provider, CngKeyOpenOptions.UserKey);
            }
            else
            {
                key = CreateKey(keyName);
            }

            Validate(key);
            return new WindowsInstallationProof(key);
        }
        catch (InstallationProofException)
        {
            key?.Dispose();
            throw;
        }
        catch (Exception error) when (
            error is CryptographicException or ArgumentException)
        {
            key?.Dispose();
            throw new InstallationProofException(error);
        }
    }

    public static WindowsInstallationProof RepairAndRecreate() =>
        RepairAndRecreate(KeyName);

    internal static WindowsInstallationProof RepairAndRecreate(string keyName)
    {
        ValidateKeyName(keyName);
        try
        {
            if (CngKey.Exists(keyName, Provider, CngKeyOpenOptions.UserKey))
            {
                using (var existing = CngKey.Open(
                    keyName,
                    Provider,
                    CngKeyOpenOptions.UserKey))
                {
                    existing.Delete();
                }
            }
            return GetOrCreate(keyName);
        }
        catch (InstallationProofException)
        {
            throw;
        }
        catch (Exception error) when (
            error is CryptographicException or ArgumentException)
        {
            throw new InstallationProofException(error);
        }
    }

    private static CngKey CreateKey(string keyName) => CngKey.Create(
        CngAlgorithm.ECDsaP256,
        keyName,
        new CngKeyCreationParameters
        {
            ExportPolicy = CngExportPolicies.None,
            KeyUsage = CngKeyUsages.Signing,
            Provider = Provider,
        });

    private static void ValidateKeyName(string keyName)
    {
        if (string.IsNullOrWhiteSpace(keyName) || keyName.Length > 240)
        {
            throw new ArgumentException(
                "Presenter proof key name is invalid.",
                nameof(keyName));
        }
    }

    private static void Validate(CngKey key)
    {
        if (key.Provider != Provider ||
            key.IsMachineKey ||
            key.Algorithm != CngAlgorithm.ECDsaP256 ||
            key.AlgorithmGroup != CngAlgorithmGroup.ECDsa ||
            key.KeySize != 256 ||
            key.KeyUsage != CngKeyUsages.Signing ||
            key.ExportPolicy != CngExportPolicies.None)
        {
            throw new InstallationProofException();
        }

        using var signingKey = new ECDsaCng(key);
        Span<byte> challenge = stackalloc byte[32];
        RandomNumberGenerator.Fill(challenge);
        var signature = signingKey.SignData(
            challenge,
            HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        try
        {
            if (!signingKey.VerifyData(
                    challenge,
                    signature,
                    HashAlgorithmName.SHA256,
                    DSASignatureFormat.IeeeP1363FixedFieldConcatenation))
            {
                throw new InstallationProofException();
            }
        }
        finally
        {
            CryptographicOperations.ZeroMemory(challenge);
            CryptographicOperations.ZeroMemory(signature);
        }
    }

    public PresenterRequestProofHeaders Sign(
        ReadOnlySpan<byte> body,
        DateTimeOffset? now = null,
        ReadOnlySpan<byte> nonce = default) =>
        signer.Sign(body, now, nonce);

    public void Dispose()
    {
        signer.Dispose();
        key.Dispose();
    }
}

internal sealed class InstallationProofException : CryptographicException
{
    public InstallationProofException()
        : base("Presenter installation proof is invalid and must be repaired.")
    {
        Code = "installation_proof_invalid";
    }

    public InstallationProofException(Exception innerException)
        : base(
            "Presenter installation proof is invalid and must be repaired.",
            innerException)
    {
        Code = "installation_proof_invalid";
    }

    public string Code { get; }
}
