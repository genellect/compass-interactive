using System.Runtime.InteropServices;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Security.Cryptography.Pkcs;
using System.Security.Cryptography.X509Certificates;
using System.Xml;
using System.Xml.Linq;
using Velopack;

namespace Compass.Presenter.App;

internal static class PresenterUpdateTrust
{
    internal const string PackageId = "CompassPresenterBridge";
    private const string Sha256Oid = "2.16.840.1.101.3.4.2.1";
    private const string CodeSigningOid = "1.3.6.1.5.5.7.3.3";

    internal static void ValidateAsset(VelopackAsset asset)
    {
        if (asset.PackageId != PackageId || asset.Version is null || asset.Type != VelopackAssetType.Full ||
            asset.Size <= 0 || asset.Size > 256L * 1024 * 1024 ||
            asset.SHA256 is not { Length: 64 } || !asset.SHA256.All(Uri.IsHexDigit) ||
            asset.FileName != Path.GetFileName(asset.FileName) ||
            !asset.FileName.StartsWith(PackageId + "-", StringComparison.Ordinal) ||
            !asset.FileName.EndsWith("-full.nupkg", StringComparison.Ordinal) ||
            asset.FileName.Any(character => !char.IsAsciiLetterOrDigit(character) &&
                character is not '.' and not '-' and not '_'))
        {
            throw new InvalidOperationException("The Presenter release identity is invalid.");
        }
    }

    internal static async Task VerifyPackageAsync(
        string path, VelopackAsset asset, byte[] signature, string publisher,
        CancellationToken cancellationToken)
    {
        ValidateAsset(asset);
        if (new FileInfo(path).Length != asset.Size)
        {
            throw new InvalidOperationException("The Presenter package size is invalid.");
        }
        var bytes = await File.ReadAllBytesAsync(path, cancellationToken).ConfigureAwait(false);
        if (!Convert.ToHexString(SHA256.HashData(bytes)).Equals(asset.SHA256,
                StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("The Presenter package digest is invalid.");
        }
        VerifyDetachedSignature(bytes, signature, publisher);
        VerifyPackageIdentity(bytes, asset);
        cancellationToken.ThrowIfCancellationRequested();
    }

    internal static void VerifyPackageIdentity(byte[] bytes, VelopackAsset asset)
    {
        using var input = new MemoryStream(bytes, writable: false);
        using var archive = new ZipArchive(input, ZipArchiveMode.Read);
        var manifests = archive.Entries.Where(entry =>
            !entry.FullName.Contains('/') && !entry.FullName.Contains('\\') &&
            entry.FullName.EndsWith(".nuspec", StringComparison.Ordinal)).ToArray();
        if (manifests.Length != 1 || manifests[0].Length > 1024 * 1024)
            throw new InvalidOperationException("The Presenter package manifest is invalid.");
        using var manifest = manifests[0].Open();
        using var reader = XmlReader.Create(manifest, new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null,
            MaxCharactersInDocument = 1024 * 1024,
        });
        var document = XDocument.Load(reader);
        var metadata = document.Root?.Elements().SingleOrDefault(element =>
            element.Name.LocalName == "metadata");
        string? Value(string name) => metadata?.Elements().SingleOrDefault(element =>
            element.Name.LocalName == name)?.Value;
        if (Value("id") != PackageId || Value("version") != asset.Version.ToString())
            throw new InvalidOperationException("The signed package does not match the release version.");
    }

    internal static void VerifyDetachedSignature(
        byte[] content, byte[] signature, string publisher,
        Func<X509Certificate2, X509Certificate2Collection, bool>? verifyChain = null)
    {
        if (signature.Length is 0 or > 256 * 1024 || string.IsNullOrWhiteSpace(publisher))
        {
            throw new CryptographicException("A signed Presenter package is required.");
        }
        var cms = new SignedCms(new ContentInfo(content), detached: true);
        cms.Decode(signature);
        if (!cms.Detached || cms.SignerInfos.Count != 1 ||
            cms.SignerInfos[0].DigestAlgorithm.Value != Sha256Oid ||
            cms.SignerInfos[0].Certificate is not { } certificate ||
            certificate.Subject != publisher)
        {
            throw new CryptographicException("The Presenter package publisher is invalid.");
        }
        cms.CheckSignature(verifySignatureOnly: true);
        // CMS timestamps are not treated as trusted Authenticode timestamps.
        // A currently valid code-signing chain is mandatory for package signatures.
        if (!(verifyChain ?? VerifyCodeSigningChain)(certificate, cms.Certificates))
        {
            throw new CryptographicException("The Presenter package signer is not trusted.");
        }
    }

    private static bool VerifyCodeSigningChain(
        X509Certificate2 certificate, X509Certificate2Collection certificates)
    {
        using var chain = new X509Chain();
        chain.ChainPolicy.ExtraStore.AddRange(certificates);
        chain.ChainPolicy.ApplicationPolicy.Add(new Oid(CodeSigningOid));
        chain.ChainPolicy.RevocationMode = X509RevocationMode.Online;
        chain.ChainPolicy.RevocationFlag = X509RevocationFlag.ExcludeRoot;
        chain.ChainPolicy.UrlRetrievalTimeout = TimeSpan.FromSeconds(3);
        return chain.Build(certificate);
    }

    internal static string GetInstalledPublisher()
    {
        var path = Environment.ProcessPath ?? throw new InvalidOperationException(
            "The installed Presenter executable is unavailable.");
        var file = new TrustFile { Size = (uint)Marshal.SizeOf<TrustFile>(), FilePath = path };
        var filePointer = Marshal.AllocHGlobal(Marshal.SizeOf<TrustFile>());
        Marshal.StructureToPtr(file, filePointer, false);
        var data = new TrustData
        {
            Size = (uint)Marshal.SizeOf<TrustData>(), UiChoice = 2,
            RevocationChecks = 1, UnionChoice = 1, File = filePointer, StateAction = 1,
        };
        var action = new Guid("00AAC56B-CD44-11D0-8CC2-00C04FC295EE");
        try
        {
            if (WinVerifyTrust(new nint(-1), ref action, ref data) != 0)
            {
                throw new CryptographicException("The installed Presenter publisher is not trusted.");
            }
            return ReadEmbeddedPublisher(path);
        }
        finally
        {
            data.StateAction = 2;
            _ = WinVerifyTrust(new nint(-1), ref action, ref data);
            Marshal.DestroyStructure<TrustFile>(filePointer);
            Marshal.FreeHGlobal(filePointer);
        }
    }

    private static string ReadEmbeddedPublisher(string path)
    {
        using var stream = File.OpenRead(path);
        using var reader = new BinaryReader(stream);
        stream.Position = 0x3c;
        var peOffset = reader.ReadUInt32();
        stream.Position = peOffset;
        if (reader.ReadUInt32() != 0x4550) throw new CryptographicException("Invalid PE signature.");
        var optionalHeader = peOffset + 24;
        stream.Position = optionalHeader;
        var directoryOffset = reader.ReadUInt16() switch
        {
            0x10b => 96,
            0x20b => 112,
            _ => throw new CryptographicException("Unknown PE signature."),
        };
        stream.Position = optionalHeader + directoryOffset + 32;
        var offset = reader.ReadUInt32();
        var tableLength = reader.ReadUInt32();
        if (offset == 0 || tableLength < 8 || tableLength > 16 * 1024 * 1024 ||
            (long)offset + tableLength > stream.Length)
            throw new CryptographicException("An embedded Presenter signature is required.");
        stream.Position = offset;
        var length = reader.ReadUInt32();
        if (reader.ReadUInt16() != 0x200 || reader.ReadUInt16() != 2 || length < 8 || length > tableLength)
            throw new CryptographicException("Invalid embedded Presenter signature.");
        var cms = new SignedCms();
        cms.Decode(reader.ReadBytes((int)length - 8));
        if (cms.SignerInfos.Count != 1 || cms.SignerInfos[0].Certificate is not { } certificate)
            throw new CryptographicException("A single Presenter publisher is required.");
        return certificate.Subject;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct TrustFile
    {
        public uint Size;
        [MarshalAs(UnmanagedType.LPWStr)] public string FilePath;
        public nint FileHandle;
        public nint KnownSubject;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TrustData
    {
        public uint Size;
        public nint PolicyCallbackData;
        public nint SipClientData;
        public uint UiChoice;
        public uint RevocationChecks;
        public uint UnionChoice;
        public nint File;
        public uint StateAction;
        public nint StateData;
        public nint UrlReference;
        public uint ProviderFlags;
        public uint UiContext;
        public nint SignatureSettings;
    }

    [DllImport("wintrust.dll", ExactSpelling = true, PreserveSig = true)]
    private static extern int WinVerifyTrust(nint window, ref Guid action, ref TrustData data);
}
