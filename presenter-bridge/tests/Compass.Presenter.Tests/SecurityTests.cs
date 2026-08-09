using Compass.Presenter.App;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;

namespace Compass.Presenter.Tests;

internal static class SecurityTests
{
    public static Task EndpointIsPinnedToCanonicalHost()
    {
        var accepted = BridgeOptions.ValidatePresenterEndpoint(
            BridgeOptions.ProductionPresenterEndpoint);
        Assert.Equal("presenter-api.invalid", accepted.Host);

        Assert.Throws<InvalidOperationException>(() =>
            BridgeOptions.ValidatePresenterEndpoint(
                "https://evil.example/functions/v1/presenter-bridge-session"));
        Assert.Throws<InvalidOperationException>(() =>
            BridgeOptions.ValidatePresenterEndpoint(
                "https://presenter-api.invalid:444/functions/v1/presenter-bridge-session"));
        Assert.Throws<InvalidOperationException>(() =>
            BridgeOptions.ValidatePresenterEndpoint(
                "https://user@presenter-api.invalid/functions/v1/presenter-bridge-session"));
        Assert.Throws<InvalidOperationException>(() =>
            BridgeOptions.ValidatePresenterEndpoint(
                "https://pfvedtqccblecuyjlfqh.supabase.co/functions/v1/presenter-bridge-session"));
        return Task.CompletedTask;
    }

    public static Task RequestProofIsP256BoundToExactBodyAndNonce()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        using var signer = new PresenterRequestSigner(key, ownsSigner: false);
        var body = Encoding.UTF8.GetBytes("{\"action\":\"heartbeat\"}");
        var nonce = Enumerable.Range(1, 24).Select(value => (byte)value).ToArray();
        try
        {
            var proof = signer.Sign(
                body,
                DateTimeOffset.FromUnixTimeSeconds(1_800_000_000),
                nonce);
            Assert.Equal(64, proof.KeyId.Length);
            Assert.Equal(64, PresenterRequestSigner.Base64UrlDecode(
                proof.Signature).Length);
            Assert.Equal(
                Convert.ToHexString(SHA256.HashData(
                    PresenterRequestSigner.Base64UrlDecode(
                        proof.PublicKeySpki))).ToLowerInvariant(),
                proof.KeyId);

            var canonical = PresenterRequestSigner.BuildCanonicalForTest(
                body,
                proof.Timestamp,
                proof.Nonce);
            try
            {
                Assert.True(key.VerifyData(
                    canonical,
                    PresenterRequestSigner.Base64UrlDecode(proof.Signature),
                    HashAlgorithmName.SHA256,
                    DSASignatureFormat.IeeeP1363FixedFieldConcatenation));

                var changedBody = Encoding.UTF8.GetBytes(
                    "{\"action\":\"disconnect\"}");
                try
                {
                    var changedCanonical =
                        PresenterRequestSigner.BuildCanonicalForTest(
                            changedBody,
                            proof.Timestamp,
                            proof.Nonce);
                    try
                    {
                        Assert.False(key.VerifyData(
                            changedCanonical,
                            PresenterRequestSigner.Base64UrlDecode(
                                proof.Signature),
                            HashAlgorithmName.SHA256,
                            DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
                    }
                    finally
                    {
                        CryptographicOperations.ZeroMemory(changedCanonical);
                    }
                }
                finally
                {
                    CryptographicOperations.ZeroMemory(changedBody);
                }
            }
            finally
            {
                CryptographicOperations.ZeroMemory(canonical);
            }
        }
        finally
        {
            CryptographicOperations.ZeroMemory(body);
            CryptographicOperations.ZeroMemory(nonce);
        }
        return Task.CompletedTask;
    }

    public static async Task TransportRetryReusesProofAndNextCallUsesFreshNonce()
    {
        using var signer = new DeterministicRequestSigner();
        using var handler = new RecordingRetryHandler();
        using var client = new EdgePresenterClient(
            new Uri(
                "https://presenter-api.invalid/functions/v1/presenter-bridge-session"),
            signer,
            handler);
        var capability = new PresenterCapability(
            Guid.Parse("11111111-1111-4111-8111-111111111111"),
            Guid.Parse("22222222-2222-4222-8222-222222222222"),
            "test-capability-token",
            DateTimeOffset.UtcNow.AddMinutes(5));

        var first = await client.HeartbeatAsync(
            capability,
            signer.KeyId,
            new string('a', 64),
            new string('b', 64),
            CancellationToken.None);
        var second = await client.HeartbeatAsync(
            capability,
            signer.KeyId,
            new string('a', 64),
            new string('b', 64),
            CancellationToken.None);

        Assert.True(first.Active);
        Assert.True(second.Active);
        Assert.Equal(2, signer.SignCalls);
        Assert.Equal(3, handler.Requests.Count);

        var initialAttempt = handler.Requests[0];
        var retryAttempt = handler.Requests[1];
        var nextLogicalRequest = handler.Requests[2];
        Assert.SequenceEqual(initialAttempt.Body, retryAttempt.Body);
        foreach (var name in ProofHeaderNames)
        {
            Assert.Equal(
                initialAttempt.ProofHeaders[name],
                retryAttempt.ProofHeaders[name]);
        }

        Assert.SequenceEqual(initialAttempt.Body, nextLogicalRequest.Body);
        Assert.False(
            initialAttempt.ProofHeaders["X-Compass-Presenter-Nonce"] ==
            nextLogicalRequest.ProofHeaders["X-Compass-Presenter-Nonce"]);
        Assert.False(
            initialAttempt.ProofHeaders["X-Compass-Presenter-Signature"] ==
            nextLogicalRequest.ProofHeaders["X-Compass-Presenter-Signature"]);
    }

    public static async Task RateLimitIsTransientAndPreservesRetryAfter()
    {
        using var signer = new DeterministicRequestSigner();
        using var handler = new RateLimitedHandler();
        using var client = new EdgePresenterClient(
            new Uri(
                "https://presenter-api.invalid/functions/v1/presenter-bridge-session"),
            signer,
            handler);
        var capability = new PresenterCapability(
            Guid.Parse("11111111-1111-4111-8111-111111111111"),
            Guid.Parse("22222222-2222-4222-8222-222222222222"),
            "test-capability-token",
            DateTimeOffset.UtcNow.AddMinutes(5));

        try
        {
            _ = await client.HeartbeatAsync(
                capability,
                signer.KeyId,
                new string('a', 64),
                new string('b', 64),
                CancellationToken.None);
            throw new TestFailureException("Expected a rate-limit response.");
        }
        catch (PresenterRemoteException error)
        {
            Assert.Equal("rate_limited", error.Code);
            Assert.True(error.Transient);
            Assert.Equal(TimeSpan.FromSeconds(7), error.RetryAfter);
            Assert.Equal(1, handler.RequestCount);
        }
    }

    public static async Task ManualRecoveryRejectsLocalEligibilityBeforeHostedInspect()
    {
        using var signer = new DeterministicRequestSigner();
        using var handler = new UnexpectedRequestHandler();
        using var client = new EdgePresenterClient(
            new Uri(
                "https://presenter-api.invalid/functions/v1/presenter-bridge-session"),
            signer,
            handler);
        var source = new FakePresentationSource(
            TestData.Observation(
                page: 1,
                timestamp: TestData.Milliseconds(1),
                presenterView: true));
        await using var coordinator = new PresenterSessionCoordinator(
            client,
            source,
            signer.KeyId);
        var recovery = new ManualRecoveryService(
            client,
            coordinator,
            source,
            signer.KeyId);

        try
        {
            await recovery.RecoverAsync(
                "ABCD2345",
                _ => { },
                CancellationToken.None);
            throw new TestFailureException(
                "Expected the local presentation to be rejected.");
        }
        catch (PresenterRemoteException error)
        {
            Assert.Equal("presenter_view_must_be_disabled", error.Code);
            Assert.Equal(0, handler.RequestCount);
        }
    }

    public static Task WindowsInstallationProofRejectsAndRepairsInvalidUserKey()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041))
        {
            return Task.CompletedTask;
        }

        var keyName =
            $"COMPASS Interactive/PresenterBridge/Test/{Guid.NewGuid():N}";
        var provider = CngProvider.MicrosoftSoftwareKeyStorageProvider;
        try
        {
            using (CngKey.Create(
                CngAlgorithm.Rsa,
                keyName,
                new CngKeyCreationParameters
                {
                    ExportPolicy = CngExportPolicies.None,
                    KeyUsage = CngKeyUsages.Signing,
                    Provider = provider,
                }))
            {
            }

            var invalidKeyRejected = false;
            try
            {
                using var invalid = WindowsInstallationProof.GetOrCreate(keyName);
            }
            catch (InstallationProofException)
            {
                invalidKeyRejected = true;
            }
            Assert.True(invalidKeyRejected);

            string repairedKeyId;
            using (var repaired =
                WindowsInstallationProof.RepairAndRecreate(keyName))
            {
                repairedKeyId = repaired.KeyId;
                Assert.Equal(64, repairedKeyId.Length);
            }
            using (var reopened = WindowsInstallationProof.GetOrCreate(keyName))
            {
                Assert.Equal(repairedKeyId, reopened.KeyId);
            }
        }
        finally
        {
            try
            {
                using var cleanup = CngKey.Open(
                    keyName,
                    provider,
                    CngKeyOpenOptions.UserKey);
                cleanup.Delete();
            }
            catch (CryptographicException error) when (
                error.HResult == unchecked((int)0x80070002) ||
                error.HResult == unchecked((int)0x80090016))
            {
                // The test key was already absent.
            }
        }
        return Task.CompletedTask;
    }

    private static readonly string[] ProofHeaderNames =
    [
        "X-Compass-Presenter-Key-Id",
        "X-Compass-Presenter-Public-Key",
        "X-Compass-Presenter-Timestamp",
        "X-Compass-Presenter-Nonce",
        "X-Compass-Presenter-Signature",
    ];

    private sealed record RecordedRequest(
        byte[] Body,
        IReadOnlyDictionary<string, string> ProofHeaders);

    private sealed class RecordingRetryHandler : HttpMessageHandler
    {
        public List<RecordedRequest> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var body = request.Content is null
                ? []
                : await request.Content.ReadAsByteArrayAsync(cancellationToken);
            var headers = ProofHeaderNames.ToDictionary(
                name => name,
                name => request.Headers.GetValues(name).Single(),
                StringComparer.OrdinalIgnoreCase);
            Requests.Add(new RecordedRequest(body, headers));
            if (Requests.Count == 1)
            {
                throw new HttpRequestException("Synthetic transport failure.");
            }

            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    "{\"ok\":true,\"active\":true}",
                    Encoding.UTF8,
                    "application/json"),
            };
            response.Headers.CacheControl = new CacheControlHeaderValue
            {
                NoStore = true,
            };
            return response;
        }
    }

    private sealed class RateLimitedHandler : HttpMessageHandler
    {
        public int RequestCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            RequestCount++;
            var response = new HttpResponseMessage(
                HttpStatusCode.TooManyRequests)
            {
                Content = new StringContent(
                    "{\"ok\":false,\"code\":\"rate_limited\",\"message\":\"Wait.\"}",
                    Encoding.UTF8,
                    "application/json"),
            };
            response.Headers.CacheControl = new CacheControlHeaderValue
            {
                NoStore = true,
            };
            response.Headers.RetryAfter = new RetryConditionHeaderValue(
                TimeSpan.FromSeconds(7));
            return Task.FromResult(response);
        }
    }

    private sealed class UnexpectedRequestHandler : HttpMessageHandler
    {
        public int RequestCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            RequestCount++;
            throw new TestFailureException(
                "Hosted inspect ran before local eligibility validation.");
        }
    }

    private sealed class DeterministicRequestSigner :
        IPresenterRequestSigner,
        IDisposable
    {
        private readonly PresenterRequestSigner signer = new(
            ECDsa.Create(ECCurve.NamedCurves.nistP256));
        private int signCalls;

        public string KeyId => signer.KeyId;

        public string PublicKeySpki => signer.PublicKeySpki;

        public int SignCalls => Volatile.Read(ref signCalls);

        public PresenterRequestProofHeaders Sign(
            ReadOnlySpan<byte> body,
            DateTimeOffset? now = null,
            ReadOnlySpan<byte> nonce = default)
        {
            var call = Interlocked.Increment(ref signCalls);
            Span<byte> deterministicNonce = stackalloc byte[24];
            deterministicNonce.Fill(checked((byte)call));
            try
            {
                return signer.Sign(
                    body,
                    DateTimeOffset.FromUnixTimeSeconds(1_800_000_000),
                    deterministicNonce);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(deterministicNonce);
            }
        }

        public void Dispose() => signer.Dispose();
    }
}
