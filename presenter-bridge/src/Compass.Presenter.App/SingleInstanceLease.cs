using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

namespace Compass.Presenter.App;

[SupportedOSPlatform("windows10.0.19041")]
internal sealed class SingleInstanceLease : IDisposable
{
    private readonly Mutex mutex;
    private bool disposed;

    private SingleInstanceLease(Mutex mutex)
    {
        this.mutex = mutex;
    }

    public static SingleInstanceLease? TryAcquire()
    {
        var userSid = WindowsIdentity.GetCurrent().User?.Value ??
            throw new InvalidOperationException(
                "The current Windows user could not be identified.");
        var suffix = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(userSid)))[..24];
        var mutex = new Mutex(
            initiallyOwned: true,
            $"Local\\COMPASS.Interactive.PresenterBridge.{suffix}",
            out var createdNew);
        if (!createdNew)
        {
            mutex.Dispose();
            return null;
        }
        return new SingleInstanceLease(mutex);
    }

    public void Dispose()
    {
        if (disposed)
        {
            return;
        }
        disposed = true;
        try
        {
            mutex.ReleaseMutex();
        }
        finally
        {
            mutex.Dispose();
        }
    }
}
