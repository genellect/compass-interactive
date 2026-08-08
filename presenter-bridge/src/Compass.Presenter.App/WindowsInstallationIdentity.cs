using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;

namespace Compass.Presenter.App;

[SupportedOSPlatform("windows10.0.19041")]
internal static class WindowsInstallationIdentity
{
    private const uint CredentialTypeGeneric = 1;
    private const uint CredentialPersistLocalMachine = 2;
    private const int ErrorNotFound = 1168;
    private const string TargetName =
        "COMPASS Interactive/PresenterBridge/Installation/v1";

    public static string GetOrCreateHash()
    {
        var encoded = ReadCredential();
        if (encoded is null)
        {
            var generated = RandomNumberGenerator.GetBytes(32);
            try
            {
                encoded = Convert.ToBase64String(generated);
                WriteCredential(encoded);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(generated);
            }
        }

        byte[] raw;
        try
        {
            raw = Convert.FromBase64String(encoded);
        }
        catch (FormatException error)
        {
            throw new InvalidOperationException(
                "Presenter installation identity is invalid.",
                error);
        }
        if (raw.Length != 32)
        {
            CryptographicOperations.ZeroMemory(raw);
            throw new InvalidOperationException(
                "Presenter installation identity is invalid.");
        }

        try
        {
            return Convert.ToHexString(SHA256.HashData(raw)).ToLowerInvariant();
        }
        finally
        {
            CryptographicOperations.ZeroMemory(raw);
        }
    }

    private static string? ReadCredential()
    {
        if (!CredReadW(
                TargetName,
                CredentialTypeGeneric,
                0,
                out var credentialPointer))
        {
            var error = Marshal.GetLastWin32Error();
            if (error == ErrorNotFound)
            {
                return null;
            }
            throw new Win32Exception(error);
        }

        try
        {
            var credential = Marshal.PtrToStructure<NativeCredential>(
                credentialPointer);
            if (credential.CredentialBlob == IntPtr.Zero ||
                credential.CredentialBlobSize is < 1 or > 512)
            {
                throw new InvalidOperationException(
                    "Presenter installation identity is invalid.");
            }
            var bytes = new byte[checked((int)credential.CredentialBlobSize)];
            try
            {
                Marshal.Copy(
                    credential.CredentialBlob,
                    bytes,
                    0,
                    bytes.Length);
                return Encoding.UTF8.GetString(bytes);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(bytes);
            }
        }
        finally
        {
            CredFree(credentialPointer);
        }
    }

    private static void WriteCredential(string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        var blob = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            var credential = new NativeCredential
            {
                Type = CredentialTypeGeneric,
                TargetName = TargetName,
                CredentialBlobSize = checked((uint)bytes.Length),
                CredentialBlob = blob,
                Persist = CredentialPersistLocalMachine,
                UserName = "COMPASS Presenter Bridge",
            };
            if (!CredWriteW(ref credential, 0))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
            Marshal.FreeHGlobal(blob);
        }
    }

    [DllImport(
        "Advapi32.dll",
        EntryPoint = "CredReadW",
        CharSet = CharSet.Unicode,
        SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredReadW(
        string target,
        uint type,
        uint flags,
        out IntPtr credential);

    [DllImport(
        "Advapi32.dll",
        EntryPoint = "CredWriteW",
        CharSet = CharSet.Unicode,
        SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CredWriteW(
        ref NativeCredential credential,
        uint flags);

    [DllImport("Advapi32.dll")]
    private static extern void CredFree(IntPtr buffer);

    #pragma warning disable CS0649
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NativeCredential
    {
        public uint Flags;
        public uint Type;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string? TargetName;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string? Comment;

        public FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string? TargetAlias;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string? UserName;
    }
    #pragma warning restore CS0649
}
