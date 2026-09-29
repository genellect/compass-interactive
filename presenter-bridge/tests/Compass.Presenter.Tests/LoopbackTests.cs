using System.Net;
using System.Text;
using System.Text.Json;
using Compass.Presenter.Contracts;
using Compass.Presenter.Loopback;

namespace Compass.Presenter.Tests;

internal static class LoopbackTests
{
    private const string AllowedOrigin =
        "https://compass-interactive.pages.dev";
    private static readonly string Ticket =
        $"{new string('T', 43)}.{new string('S', 43)}";
    private static readonly Guid LectureId =
        Guid.Parse("72900000-0000-4000-8000-000000000001");

    public static async Task HealthReportsPolicyFailureWithoutLeakingDetails()
    {
        foreach (var asynchronous in new[] { false, true })
        {
            var calls = 0;
            var source = new HealthSource(_ =>
            {
                calls++;
                return asynchronous ? FailAfterAwait() : throw HealthFailureTests.BlockedAssembly();
            });
            await using var fixture = await ServerFixture.CreateAsync(source: source);
            using var hostile = fixture.Request(HttpMethod.Get, "/v1/health");
            hostile.Headers.Remove("Origin");
            hostile.Headers.Add("Origin", "https://evil.example");
            using var rejected = await fixture.Client.SendAsync(hostile);
            Assert.Equal(HttpStatusCode.Forbidden, rejected.StatusCode);
            Assert.Equal(0, calls);
            Assert.False(rejected.Headers.Contains("Access-Control-Allow-Origin"));

            for (var attempt = 0; attempt < 2; attempt++)
            {
                using var request = fixture.Request(HttpMethod.Get, "/v1/health");
                using var response = await fixture.Client.SendAsync(request);
                Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
                Assert.True(response.Headers.CacheControl?.NoStore == true);
                Assert.Equal(AllowedOrigin, response.Headers.GetValues("Access-Control-Allow-Origin").Single());
                var payload = await ReadJsonAsync(response);
                Assert.Equal(3, payload.EnumerateObject().Count());
                Assert.False(payload.GetProperty("ok").GetBoolean());
                Assert.Equal("bridge_installation_blocked", payload.GetProperty("code").GetString());
                Assert.Equal("Windows blocked Presenter Bridge execution.", payload.GetProperty("message").GetString());
            }
            Assert.Equal(1, calls);
            Assert.False(fixture.Server.HasLiveSession);
        }

        static async ValueTask<PresentationObservation?> FailAfterAwait()
        {
            await Task.Yield();
            throw HealthFailureTests.BlockedAssembly();
        }
    }

    public static async Task HealthPreservesDelayedAbsentFaultedAndHungObservations()
    {
        foreach (var scenario in new[] { "ready", "absent", "fault", "hung" })
        {
            var calls = 0;
            var source = new HealthSource(async cancellationToken =>
            {
                calls++;
                if (scenario == "hung")
                    await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
                await Task.Yield();
                if (scenario == "fault") throw new FileLoadException("Not a policy block.");
                return scenario == "ready" ? TestData.Observation(1, 0) : null;
            });
            await using var fixture = await ServerFixture.CreateAsync(source: source);
            for (var attempt = 0; attempt < 2; attempt++)
            {
                using var request = fixture.Request(HttpMethod.Get, "/v1/health");
                using var response = await fixture.Client.SendAsync(request);
                Assert.Equal(HttpStatusCode.OK, response.StatusCode);
                var payload = await ReadJsonAsync(response);
                Assert.Equal(5, payload.EnumerateObject().Count());
                Assert.True(payload.GetProperty("ok").GetBoolean());
                Assert.Equal(scenario == "ready", payload.GetProperty("powerpointReady").GetBoolean());
                Assert.Equal(scenario switch
                {
                    "ready" => null,
                    "absent" => "powerpoint_not_running",
                    _ => "observation_unavailable",
                }, payload.GetProperty("powerpointIssue").GetString());
            }
            Assert.Equal(1, calls);
        }
    }

    private sealed class HealthSource(
        Func<CancellationToken, ValueTask<PresentationObservation?>> observe) : IPresentationObservationSource
    {
        public event EventHandler? ReconcileRequested { add { } remove { } }
        public ValueTask<PresentationObservation?> ObserveAsync(CancellationToken token) => observe(token);
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    public static async Task CorsPnaAndHostAreStrict()
    {
        await using var fixture = await ServerFixture.CreateAsync();
        using var allowed = fixture.Request(HttpMethod.Options, "/v1/connect");
        allowed.Headers.Add("Access-Control-Request-Method", "POST");
        allowed.Headers.Add("Access-Control-Request-Private-Network", "true");
        using var allowedResponse = await fixture.Client.SendAsync(allowed);
        Assert.Equal(HttpStatusCode.NoContent, allowedResponse.StatusCode);
        Assert.Equal(
            "true",
            allowedResponse.Headers.GetValues(
                "Access-Control-Allow-Private-Network").Single());
        Assert.Equal(
            AllowedOrigin,
            allowedResponse.Headers.GetValues(
                "Access-Control-Allow-Origin").Single());

        using var hostile = fixture.Request(HttpMethod.Get, "/v1/health");
        hostile.Headers.Remove("Origin");
        hostile.Headers.Add("Origin", "https://evil.example");
        using var hostileResponse = await fixture.Client.SendAsync(hostile);
        Assert.Equal(HttpStatusCode.Forbidden, hostileResponse.StatusCode);
        Assert.False(hostileResponse.Headers.Contains(
            "Access-Control-Allow-Origin"));

        using var wrongHost = fixture.Request(HttpMethod.Get, "/v1/health");
        wrongHost.Headers.Host = $"localhost:{fixture.Server.Port}";
        using var wrongHostResponse = await fixture.Client.SendAsync(wrongHost);
        Assert.Equal(HttpStatusCode.Forbidden, wrongHostResponse.StatusCode);
        using var health = fixture.Request(HttpMethod.Get, "/v1/health");
        using var healthResponse = await fixture.Client.SendAsync(health);
        var healthPayload = await ReadJsonAsync(healthResponse);
        Assert.Equal(5, healthPayload.EnumerateObject().Count());
        Assert.True(healthPayload.GetProperty("ok").GetBoolean());
        Assert.Equal("compass-presenter-bridge", healthPayload.GetProperty("service").GetString());
        Assert.Equal(1, healthPayload.GetProperty("protocolVersion").GetInt32());
        Assert.True(healthPayload.GetProperty("powerpointReady").GetBoolean());
        Assert.Equal(JsonValueKind.Null, healthPayload.GetProperty("powerpointIssue").ValueKind);
    }

    public static async Task PairActivateStatusAndDisconnectAreOriginBound()
    {
        await using var fixture = await ServerFixture.CreateAsync();
        using var connect = fixture.JsonRequest(HttpMethod.Post, "/v1/connect", new
        {
            ticket = Ticket,
            lectureSessionId = LectureId,
            pdfDocumentId = "lecture-material",
            pdfDocumentVersion = new string('b', 64),
            pdfPageCount = 50,
        });
        using var connectResponse = await fixture.Client.SendAsync(connect);
        await AssertOkAsync(connectResponse);
        var payload = await ReadJsonAsync(connectResponse);
        Assert.Equal("pending_confirmation", payload.GetProperty("state").GetString());
        Assert.True(fixture.Server.HasLiveSession);
        var token = payload.GetProperty("sessionToken").GetString();
        Assert.True(PresenterLoopbackTokenSyntax(token));
        var binding = payload.GetProperty("presentation")
            .GetProperty("bindingDigest").GetString();

        using var activate = fixture.JsonRequest(
            HttpMethod.Post,
            "/v1/connect",
            new { action = "activate", bindingDigest = binding },
            token);
        using var activateResponse = await fixture.Client.SendAsync(activate);
        await AssertOkAsync(activateResponse);

        using var status = fixture.Request(HttpMethod.Get, "/v1/status", token);
        using var statusResponse = await fixture.Client.SendAsync(status);
        var statusPayload = await ReadJsonAsync(statusResponse);
        Assert.Equal("active", statusPayload.GetProperty("state").GetString());
        Assert.True(fixture.Server.HasLiveSession);

        using var hostileStatus = fixture.Request(
            HttpMethod.Get,
            "/v1/status",
            token);
        hostileStatus.Headers.Remove("Origin");
        hostileStatus.Headers.Add("Origin", "https://evil.example");
        using var hostileStatusResponse = await fixture.Client.SendAsync(
            hostileStatus);
        Assert.Equal(HttpStatusCode.Forbidden, hostileStatusResponse.StatusCode);

        using var disconnect = fixture.Request(
            HttpMethod.Post,
            "/v1/disconnect",
            token);
        using var disconnectResponse = await fixture.Client.SendAsync(disconnect);
        await AssertOkAsync(disconnectResponse);
        Assert.False(fixture.Server.HasLiveSession);

        using var replay = fixture.JsonRequest(HttpMethod.Post, "/v1/connect", new
        {
            ticket = Ticket,
            lectureSessionId = LectureId,
            pdfDocumentId = "lecture-material",
            pdfDocumentVersion = new string('b', 64),
            pdfPageCount = 50,
        });
        using var replayResponse = await fixture.Client.SendAsync(replay);
        Assert.Equal(HttpStatusCode.Unauthorized, replayResponse.StatusCode);
    }

    public static async Task InvalidBodiesFailBeforePairing()
    {
        await using var fixture = await ServerFixture.CreateAsync();
        using var unknownField = fixture.JsonRequest(
            HttpMethod.Post,
            "/v1/connect",
            new
            {
                ticket = Ticket,
                lectureSessionId = LectureId,
                pdfDocumentId = "lecture-material",
                pdfDocumentVersion = new string('b', 64),
                pdfPageCount = 50,
                unexpectedSecret = "must-be-rejected",
            });
        using var unknownResponse = await fixture.Client.SendAsync(unknownField);
        Assert.Equal(HttpStatusCode.BadRequest, unknownResponse.StatusCode);

        using var transferEncoded = fixture.Request(HttpMethod.Post, "/v1/connect");
        transferEncoded.Content = new StringContent("{}", Encoding.UTF8, "application/json");
        transferEncoded.Headers.TransferEncodingChunked = true;
        using var transferResponse = await fixture.Client.SendAsync(transferEncoded);
        Assert.Equal(HttpStatusCode.BadRequest, transferResponse.StatusCode);
    }

    public static async Task RuntimeFaultCannotRemainFalselyActive()
    {
        var activationHandler = new FakeActivationHandler();
        await using var fixture = await ServerFixture.CreateAsync(
            activationHandler);
        using var connect = fixture.JsonRequest(HttpMethod.Post, "/v1/connect", new
        {
            ticket = Ticket,
            lectureSessionId = LectureId,
            pdfDocumentId = "lecture-material",
            pdfDocumentVersion = new string('b', 64),
            pdfPageCount = 50,
        });
        using var connectResponse = await fixture.Client.SendAsync(connect);
        await AssertOkAsync(connectResponse);
        var connectPayload = await ReadJsonAsync(connectResponse);
        var token = connectPayload.GetProperty("sessionToken").GetString();
        var binding = connectPayload.GetProperty("presentation")
            .GetProperty("bindingDigest").GetString();

        using var activate = fixture.JsonRequest(
            HttpMethod.Post,
            "/v1/connect",
            new { action = "activate", bindingDigest = binding },
            token);
        using var activateResponse = await fixture.Client.SendAsync(activate);
        await AssertOkAsync(activateResponse);

        activationHandler.Fail();

        using var status = fixture.Request(HttpMethod.Get, "/v1/status", token);
        using var statusResponse = await fixture.Client.SendAsync(status);
        var statusPayload = await ReadJsonAsync(statusResponse);
        Assert.Equal("faulted", statusPayload.GetProperty("state").GetString());
        Assert.Equal(
            PresenterIssueCodes.PresenterSessionStopped,
            statusPayload.GetProperty("lastErrorCode").GetString());
    }

    private static bool PresenterLoopbackTokenSyntax(string? token) =>
        token is not null &&
        token.Length == 43 &&
        token.All(character =>
            char.IsAsciiLetterOrDigit(character) || character is '_' or '-');

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        var document = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync());
        return document.RootElement.Clone();
    }

    private static async Task AssertOkAsync(HttpResponseMessage response)
    {
        if (response.StatusCode != HttpStatusCode.OK)
        {
            throw new TestFailureException(
                $"Expected OK, received {response.StatusCode}: " +
                await response.Content.ReadAsStringAsync());
        }
    }

    private sealed class ServerFixture : IAsyncDisposable
    {
        private ServerFixture(
            LoopbackPresenterServer server,
            HttpClient client)
        {
            Server = server;
            Client = client;
        }

        public LoopbackPresenterServer Server { get; }

        public HttpClient Client { get; }

        public static async Task<ServerFixture> CreateAsync(
            IPresenterSessionActivationHandler? activationHandler = null,
            IPresentationObservationSource? source = null)
        {
            source ??= new FakePresentationSource(TestData.Observation(1, 0));
            var verifier = new FakePairingTicketVerifier(Ticket);
            var server = await LoopbackPresenterServer.StartAsync(
                [AllowedOrigin],
                verifier,
                source,
                activationHandler,
                port: 0,
                pairingAttemptsPerMinute: 100);
            return new ServerFixture(
                server,
                new HttpClient
                {
                    BaseAddress = new Uri($"http://127.0.0.1:{server.Port}"),
                    Timeout = TimeSpan.FromSeconds(3),
                });
        }

        public HttpRequestMessage Request(
            HttpMethod method,
            string path,
            string? sessionToken = null)
        {
            var request = new HttpRequestMessage(method, path);
            request.Headers.Add("Origin", AllowedOrigin);
            if (sessionToken is not null)
            {
                request.Headers.Add(
                    LoopbackPresenterServer.SessionHeader,
                    sessionToken);
            }

            return request;
        }

        public HttpRequestMessage JsonRequest(
            HttpMethod method,
            string path,
            object body,
            string? sessionToken = null)
        {
            var request = Request(method, path, sessionToken);
            request.Content = new StringContent(
                JsonSerializer.Serialize(body),
                Encoding.UTF8,
                "application/json");
            return request;
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await Server.DisposeAsync();
        }
    }
}
