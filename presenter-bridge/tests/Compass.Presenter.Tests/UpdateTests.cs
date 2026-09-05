using System.Net;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Security.Cryptography.Pkcs;
using System.Security.Cryptography.X509Certificates;
using Compass.Presenter.App;
using Velopack;

namespace Compass.Presenter.Tests;

internal static class UpdateTests
{
    public static Task SignedPackageMetadataRejectsFeedVersionSpoofing()
    {
        using var bytes = new MemoryStream();
        using (var archive = new ZipArchive(bytes, ZipArchiveMode.Create, leaveOpen: true))
        {
            using var manifest = new StreamWriter(archive.CreateEntry("CompassPresenterBridge.nuspec").Open());
            manifest.Write("<package><metadata><id>CompassPresenterBridge</id><version>0.1.0</version></metadata></package>");
        }
        var asset = new VelopackAsset
        {
            PackageId = PresenterUpdateTrust.PackageId, Version = SemanticVersion.Parse("0.1.0"),
        };
        PresenterUpdateTrust.VerifyPackageIdentity(bytes.ToArray(), asset);
        asset.Version = SemanticVersion.Parse("0.1.1");
        Assert.Throws<InvalidOperationException>(() =>
            PresenterUpdateTrust.VerifyPackageIdentity(bytes.ToArray(), asset));
        return Task.CompletedTask;
    }

    public static async Task PackageSignaturesBindPublisherExactBytesAndCachedFile()
    {
        using var key = RSA.Create(2048);
        var request = new CertificateRequest("CN=Presenter Test Publisher", key,
            HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var certificate = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1),
            DateTimeOffset.UtcNow.AddMinutes(10));
        byte[] content = [1, 2, 3, 4];
        var cms = new SignedCms(new ContentInfo(content), detached: true);
        cms.ComputeSignature(new CmsSigner(certificate)
        {
            DigestAlgorithm = new Oid("2.16.840.1.101.3.4.2.1"),
        });
        var signature = cms.Encode();
        // The injected chain predicate tests cryptographic binding only. It never
        // changes Windows trust or installs the ephemeral test certificate.
        PresenterUpdateTrust.VerifyDetachedSignature(content, signature, certificate.Subject,
            (_, _) => true);
        Assert.Throws<CryptographicException>(() => PresenterUpdateTrust.VerifyDetachedSignature(
            content, signature, "CN=Different Publisher", (_, _) => true));
        Assert.Throws<CryptographicException>(() => PresenterUpdateTrust.VerifyDetachedSignature(
            [1, 2, 3, 5], signature, certificate.Subject, (_, _) => true));
        Assert.Throws<CryptographicException>(() => PresenterUpdateTrust.VerifyDetachedSignature(
            content, [], certificate.Subject, (_, _) => true));
        Assert.Throws<CryptographicException>(() => PresenterUpdateTrust.VerifyDetachedSignature(
            content, signature, certificate.Subject, (_, _) => false));
        var asset = new VelopackAsset
        {
            PackageId = PresenterUpdateTrust.PackageId,
            Version = SemanticVersion.Parse("0.1.1"),
            FileName = "CompassPresenterBridge-0.1.1-full.nupkg",
            Type = VelopackAssetType.Full, Size = content.Length,
            SHA256 = Convert.ToHexString(SHA256.HashData(content)),
        };
        PresenterUpdateTrust.ValidateAsset(asset);
        asset.PackageId = "OtherApp";
        Assert.Throws<InvalidOperationException>(() => PresenterUpdateTrust.ValidateAsset(asset));
        asset.PackageId = PresenterUpdateTrust.PackageId;
        asset.SHA256 = "";
        Assert.Throws<InvalidOperationException>(() => PresenterUpdateTrust.ValidateAsset(asset));
        asset.SHA256 = Convert.ToHexString(SHA256.HashData(content));
        asset.FileName = "../CompassPresenterBridge-0.1.1-full.nupkg";
        Assert.Throws<InvalidOperationException>(() => PresenterUpdateTrust.ValidateAsset(asset));
        asset.FileName = "CompassPresenterBridge-0.1.1-full.nupkg";
        var cached = Path.Combine(Path.GetTempPath(), "compass-package-test-" + Guid.NewGuid().ToString("N"));
        try
        {
            await File.WriteAllBytesAsync(cached, [1, 2, 3, 5]);
            try
            {
                await PresenterUpdateTrust.VerifyPackageAsync(cached, asset, signature,
                    certificate.Subject, CancellationToken.None);
                Assert.True(false, "A changed cached package must be rejected.");
            }
            catch (InvalidOperationException) { }
            await File.WriteAllBytesAsync(cached, content);
            try
            {
                await PresenterUpdateTrust.VerifyPackageAsync(cached, asset, [],
                    certificate.Subject, CancellationToken.None);
                Assert.True(false, "An unsigned cached package must be rejected.");
            }
            catch (CryptographicException) { }
        }
        finally { File.Delete(cached); }
    }

    public static async Task UpdateRefusesInspectPendingAndActiveConnection()
    {
        using var activityGate = new SemaphoreSlim(1, 1);
        var pending = false;
        var active = false;
        var provider = new RecordingUpdater();
        var updates = new PresenterUpdateCoordinator(activityGate, () => pending,
            async (action, token) =>
            {
                if (active) return false;
                await action(token);
                return true;
            }, provider);
        await activityGate.WaitAsync();
        Assert.False(await updates.InstallAsync(CancellationToken.None));
        activityGate.Release();
        pending = true;
        Assert.False(await updates.InstallAsync(CancellationToken.None));
        pending = false;
        active = true;
        Assert.False(await updates.InstallAsync(CancellationToken.None));
        Assert.Equal(0, provider.CheckCount);
        Assert.Equal(0, provider.InstallCount);
        active = false;
        Assert.True(await updates.CheckAsync(CancellationToken.None));
        Assert.Equal(1, provider.CheckCount);
        Assert.Equal(0, provider.InstallCount);
        Assert.True(await updates.InstallAsync(CancellationToken.None));
        Assert.Equal(2, provider.CheckCount);
        Assert.Equal(1, provider.InstallCount);
    }

    public static async Task UpdateKeepsAdmissionLockedAndCancellationReleasesIt()
    {
        using var activityGate = new SemaphoreSlim(1, 1);
        using var cancellation = new CancellationTokenSource();
        var provider = new RecordingUpdater(blockCheck: true);
        var updates = new PresenterUpdateCoordinator(activityGate, () => false,
            async (action, token) => { await action(token); return true; }, provider);
        var checking = updates.CheckAsync(cancellation.Token);
        await provider.Started.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.False(await activityGate.WaitAsync(0));
        cancellation.Cancel();
        try
        {
            await checking;
            Assert.True(false, "A cancelled update check must not complete successfully.");
        }
        catch (OperationCanceledException)
        {
        }
        Assert.True(await activityGate.WaitAsync(0));
        activityGate.Release();
        Assert.Equal(0, provider.InstallCount);
    }

    public static async Task UpdateFeedRejectsForeignUrlsRedirectAndOversize()
    {
        foreach (var url in new[]
        {
            "http://presenter-updates.yuto-matsui.com/releases.win-x64.json",
            "https://evil.example/releases.win-x64.json",
            "https://presenter-updates.yuto-matsui.com:444/releases.win-x64.json",
            "https://user@presenter-updates.yuto-matsui.com/releases.win-x64.json",
            "https://presenter-updates.yuto-matsui.com/releases.win-x64.json#fragment",
        })
        {
            Assert.Throws<InvalidOperationException>(() =>
                PinnedPresenterUpdateDownloader.ValidateUrl(url));
        }
        using var redirect = new PinnedPresenterUpdateDownloader(
            new FeedResponseHandler(HttpStatusCode.Redirect, 0));
        try
        {
            await redirect.DownloadBytes(VelopackPresenterUpdater.FeedUrl);
            Assert.True(false, "An update redirect must be rejected.");
        }
        catch (HttpRequestException)
        {
        }
        using var oversized = new PinnedPresenterUpdateDownloader(
            new FeedResponseHandler(HttpStatusCode.OK, 256 * 1024 + 1));
        try
        {
            await oversized.DownloadBytes(VelopackPresenterUpdater.FeedUrl);
            Assert.True(false, "An oversized update feed must be rejected.");
        }
        catch (InvalidOperationException)
        {
        }
    }

    private sealed class RecordingUpdater(bool blockCheck = false) : IPresenterUpdater
    {
        public int CheckCount { get; private set; }
        public int InstallCount { get; private set; }
        public TaskCompletionSource Started { get; } = new(
            TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task<bool> CheckAsync(CancellationToken cancellationToken)
        {
            CheckCount++;
            Started.TrySetResult();
            if (blockCheck) await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return true;
        }

        public Task InstallAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            InstallCount++;
            return Task.CompletedTask;
        }
    }

    private sealed class FeedResponseHandler(HttpStatusCode status, int bytes)
        : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(status)
            {
                Content = new ByteArrayContent(new byte[bytes]),
            });
    }
}
