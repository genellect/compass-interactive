using System.Runtime.InteropServices;
using System.Text;
using Velopack;
using Velopack.Locators;
using Velopack.Sources;

namespace Compass.Presenter.App;

internal sealed class VelopackPresenterUpdater : IPresenterUpdater, IDisposable
{
    internal const string FeedUrl = "https://presenter-updates.yuto-matsui.com";
    internal const string ReleaseChannel = "win-x64";
    private readonly PinnedPresenterUpdateDownloader downloader = new();
    private readonly PresenterUpdateManager manager;
    private UpdateInfo? available;

    public VelopackPresenterUpdater()
    {
        manager = new PresenterUpdateManager(
            new SimpleWebSource(FeedUrl, downloader, timeout: 2),
            new UpdateOptions
            {
                AllowVersionDowngrade = false,
                ExplicitChannel = ReleaseChannel,
                MaximumDeltasBeforeFallback = -1,
            });
    }

    public static VelopackPresenterUpdater? TryCreate()
    {
        try
        {
            return new VelopackPresenterUpdater();
        }
        catch
        {
            return null;
        }
    }

    public async Task<bool> CheckAsync(CancellationToken cancellationToken)
    {
        available = null;
        if (!manager.IsInstalled || manager.IsPortable ||
            RuntimeInformation.ProcessArchitecture != Architecture.X64)
        {
            return false;
        }
        downloader.OperationCancellation = cancellationToken;
        available = await manager.CheckForUpdatesAsync().WaitAsync(cancellationToken)
            .ConfigureAwait(false);
        if (available is not null) PresenterUpdateTrust.ValidateAsset(available.TargetFullRelease);
        return available is not null;
    }

    public async Task InstallAsync(CancellationToken cancellationToken)
    {
        var update = available ?? throw new InvalidOperationException("No update is available.");
        var asset = update.TargetFullRelease;
        PresenterUpdateTrust.ValidateAsset(asset);
        var publisher = PresenterUpdateTrust.GetInstalledPublisher();
        downloader.OperationCancellation = cancellationToken;
        var signature = await downloader.DownloadBytes(FeedUrl + "/" + asset.FileName + ".p7s")
            .ConfigureAwait(false);
        Task Verify(string path, CancellationToken token) => PresenterUpdateTrust.VerifyPackageAsync(
            path, asset, signature, publisher, token);
        var cachedPath = manager.GetPackagePath(asset);
        if (File.Exists(cachedPath)) await Verify(cachedPath, cancellationToken).ConfigureAwait(false);
        downloader.VerifyDownloadedPackage = Verify;
        try
        {
            // Verify before the downloader returns: Velopack can extract Update.exe
            // during this call. Cached packages are checked before its early return.
            await manager.DownloadUpdatesAsync(update, cancelToken: cancellationToken)
                .ConfigureAwait(false);
            await Verify(cachedPath, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            manager.ApplyUpdatesAndRestart(update);
        }
        finally
        {
            downloader.VerifyDownloadedPackage = null;
        }
    }

    public void Dispose() => downloader.Dispose();

    private sealed class PresenterUpdateManager(IUpdateSource source, UpdateOptions options)
        : UpdateManager(source, options)
    {
        public string GetPackagePath(VelopackAsset asset) => Path.Combine(Locator.PackagesDir!, asset.FileName);
    }
}

internal sealed class PinnedPresenterUpdateDownloader : IFileDownloader, IDisposable
{
    private readonly HttpClient client;

    public PinnedPresenterUpdateDownloader(HttpMessageHandler? handler = null)
    {
        client = new HttpClient(handler ?? new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false,
            AutomaticDecompression = System.Net.DecompressionMethods.None,
            ConnectTimeout = TimeSpan.FromSeconds(3),
        })
        {
            Timeout = Timeout.InfiniteTimeSpan,
        };
    }

    public CancellationToken OperationCancellation { get; set; }
    public Func<string, CancellationToken, Task>? VerifyDownloadedPackage { get; set; }

    internal static Uri ValidateUrl(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps || !uri.IsDefaultPort ||
            uri.IdnHost != "presenter-updates.yuto-matsui.com" ||
            !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment))
        {
            throw new InvalidOperationException("The Presenter update URL is not allowed.");
        }
        return uri;
    }

    public async Task<byte[]> DownloadBytes(
        string url,
        IDictionary<string, string>? headers = null,
        double timeout = 30)
    {
        using var output = new MemoryStream();
        await DownloadAsync(url, output, 256 * 1024, TimeSpan.FromSeconds(5),
            OperationCancellation).ConfigureAwait(false);
        return output.ToArray();
    }

    public async Task<string> DownloadString(
        string url,
        IDictionary<string, string>? headers = null,
        double timeout = 30) =>
        new UTF8Encoding(false, true).GetString(
            await DownloadBytes(url, headers, timeout).ConfigureAwait(false));

    public async Task DownloadFile(
        string url,
        string targetFile,
        Action<int>? progress = null,
        IDictionary<string, string>? headers = null,
        double timeout = 30,
        CancellationToken cancelToken = default)
    {
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(
            OperationCancellation, cancelToken);
        await using (var output = new FileStream(targetFile, FileMode.Create,
            FileAccess.Write, FileShare.None, 64 * 1024, useAsync: true))
        {
            await DownloadAsync(url, output, 256 * 1024 * 1024, TimeSpan.FromMinutes(2),
                cancellation.Token).ConfigureAwait(false);
        }
        var verify = VerifyDownloadedPackage ?? throw new InvalidOperationException(
            "Presenter package signature verification is required.");
        await verify(targetFile, cancellation.Token).ConfigureAwait(false);
        progress?.Invoke(100);
    }

    private async Task DownloadAsync(
        string url,
        Stream output,
        long maximumBytes,
        TimeSpan maximumDuration,
        CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(maximumDuration);
        using var request = new HttpRequestMessage(HttpMethod.Get, ValidateUrl(url));
        request.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue
        {
            NoCache = true,
            NoStore = true,
        };
        using var response = await client.SendAsync(request,
            HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength > maximumBytes)
        {
            throw new InvalidOperationException("The Presenter update is too large.");
        }
        await using var input = await response.Content.ReadAsStreamAsync(timeout.Token)
            .ConfigureAwait(false);
        var buffer = new byte[64 * 1024];
        long length = 0;
        int read;
        while ((read = await input.ReadAsync(buffer, timeout.Token).ConfigureAwait(false)) > 0)
        {
            length += read;
            if (length > maximumBytes)
            {
                throw new InvalidOperationException("The Presenter update is too large.");
            }
            await output.WriteAsync(buffer.AsMemory(0, read), timeout.Token)
                .ConfigureAwait(false);
        }
    }

    public void Dispose() => client.Dispose();
}
