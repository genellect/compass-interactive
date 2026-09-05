using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using Compass.Presenter.Contracts;
using Compass.Presenter.Core;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

namespace Compass.Presenter.Loopback;

public sealed class LoopbackPresenterServer : IAsyncDisposable
{
    public const int DefaultPort = 43124;
    public const string SessionHeader = "X-Compass-Presenter-Session";
    private static readonly JsonSerializerOptions JsonOptions = new(
        JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    private readonly WebApplication application;
    private readonly SemaphoreSlim activationGate;
    private readonly PresenterLoopbackSessions sessions;
    private readonly IPresenterSessionFaultSource? faultSource;
    private readonly EventHandler<PresenterSessionFaultedEventArgs>? faultHandler;

    private LoopbackPresenterServer(
        WebApplication application,
        SemaphoreSlim activationGate,
        PresenterLoopbackSessions sessions,
        IPresenterSessionFaultSource? faultSource,
        EventHandler<PresenterSessionFaultedEventArgs>? faultHandler)
    {
        this.application = application;
        this.activationGate = activationGate;
        this.sessions = sessions;
        this.faultSource = faultSource;
        this.faultHandler = faultHandler;
    }

    public bool HasLiveSession => sessions.HasLiveSession;

    public int Port
    {
        get
        {
            var addresses = application.Services
                .GetRequiredService<IServer>()
                .Features
                .Get<IServerAddressesFeature>()?
                .Addresses;
            var address = addresses?.SingleOrDefault() ??
                throw new InvalidOperationException("Loopback server is not started.");
            return new Uri(address).Port;
        }
    }

    public static async Task<LoopbackPresenterServer> StartAsync(
        IEnumerable<string> allowedOrigins,
        IPairingTicketVerifier ticketVerifier,
        IPresentationObservationSource presentationSource,
        IPresenterSessionActivationHandler? activationHandler = null,
        int port = DefaultPort,
        int pairingAttemptsPerMinute = 5,
        SemaphoreSlim? activityGate = null,
        CancellationToken cancellationToken = default)
    {
        if (port is < 0 or > 65535)
        {
            throw new ArgumentOutOfRangeException(nameof(port));
        }

        var guard = new LoopbackRequestGuard(allowedOrigins);
        var sessions = new PresenterLoopbackSessions();
        var limiter = new SlidingWindowAttemptLimiter(pairingAttemptsPerMinute);
        var readinessProbe = new PresenterReadinessProbe(presentationSource);
        var activationGate = new SemaphoreSlim(1, 1);
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions
        {
            Args = [],
            ApplicationName = typeof(LoopbackPresenterServer).Assembly.FullName,
        });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Listen(IPAddress.Loopback, port);
            options.Limits.MaxRequestBodySize = 8 * 1024;
            options.AddServerHeader = false;
        });
        var app = builder.Build();

        app.Use(async (context, next) =>
        {
            var rejection = guard.ValidateConnection(context);
            if (rejection is not null)
            {
                await WriteErrorAsync(
                    context,
                    StatusCodes.Status403Forbidden,
                    "Request is not allowed.",
                    rejection);
                return;
            }

            var origin = context.Request.Headers.Origin.ToString();
            context.Response.OnStarting(() =>
            {
                context.Response.Headers.CacheControl = "no-store";
                context.Response.Headers.AccessControlAllowOrigin = origin;
                context.Response.Headers.Vary = "Origin";
                context.Response.Headers.XContentTypeOptions = "nosniff";
                context.Response.Headers["Referrer-Policy"] = "no-referrer";
                return Task.CompletedTask;
            });

            if (HttpMethods.IsOptions(context.Request.Method))
            {
                context.Response.StatusCode = StatusCodes.Status204NoContent;
                context.Response.Headers.AccessControlAllowMethods =
                    "GET, POST, OPTIONS";
                context.Response.Headers.AccessControlAllowHeaders =
                    $"Content-Type, {SessionHeader}";
                context.Response.Headers.AccessControlMaxAge = "600";
                if (string.Equals(
                    context.Request.Headers["Access-Control-Request-Private-Network"],
                    "true",
                    StringComparison.OrdinalIgnoreCase))
                {
                    context.Response.Headers["Access-Control-Allow-Private-Network"] =
                        "true";
                }

                await context.Response.CompleteAsync();
                return;
            }

            if (activityGate is not null &&
                context.Request.Path == "/v1/connect")
            {
                await activityGate.WaitAsync(context.RequestAborted);
                try
                {
                    await next(context);
                }
                finally
                {
                    activityGate.Release();
                }
            }
            else
            {
                await next(context);
            }
        });

        app.MapGet("/v1/health", async (HttpContext context) =>
        {
            var readiness = await readinessProbe.GetAsync(context.RequestAborted);
            return Results.Json(
            new
            {
                ok = true,
                service = "compass-presenter-bridge",
                protocolVersion = 1,
                powerpointReady = readiness.Ready,
                powerpointIssue = readiness.Issue,
            },
            JsonOptions);
        });

        app.MapPost("/v1/connect", async (HttpContext context) =>
        {
            var requestError = guard.ValidateJsonPost(context.Request);
            if (requestError is not null)
            {
                return Error(
                    StatusCodes.Status400BadRequest,
                    "Connect request is invalid.",
                    requestError);
            }

            ConnectRequest? request;
            try
            {
                request = await context.Request.ReadFromJsonAsync<ConnectRequest>(
                    JsonOptions,
                    context.RequestAborted);
            }
            catch (JsonException)
            {
                return Error(
                    StatusCodes.Status400BadRequest,
                    "Connect request is invalid.",
                    "json_invalid");
            }

            var origin = context.Request.Headers.Origin.ToString();
            var sessionToken = context.Request.Headers[SessionHeader].ToString();
            if (request?.Action is not null)
            {
                if (request.Action != "activate" ||
                    !LoopbackRequestGuard.IsValidDocumentVersion(
                        request.BindingDigest))
                {
                    return Error(
                        StatusCodes.Status400BadRequest,
                        "Activation request is invalid.",
                        "activation_invalid");
                }

                await activationGate.WaitAsync(context.RequestAborted);
                try
                {
                    var pending = sessions.Find(sessionToken, origin) ??
                        throw new UnauthorizedAccessException();
                    if (pending.State == "active")
                    {
                        return Results.Json(
                            new
                            {
                                ok = true,
                                state = "active",
                                presentation = pending.Presentation,
                            },
                            JsonOptions);
                    }
                    if (pending.State != "pending_confirmation" ||
                        pending.Presentation.BindingDigest !=
                            request.BindingDigest)
                    {
                        throw new InvalidOperationException();
                    }

                    var capabilityExpiry = pending.Claims.ExpiresAt;
                    if (activationHandler is not null)
                    {
                        var result = await activationHandler.ActivateAsync(
                            new PresenterSessionActivation(
                                pending.Claims,
                                pending.Presentation),
                            context.RequestAborted);
                        capabilityExpiry = result.ExpiresAt;
                    }

                    var activated = sessions.Activate(
                        sessionToken,
                        origin,
                        request.BindingDigest!,
                        capabilityExpiry);
                    return Results.Json(
                        new
                        {
                            ok = true,
                            state = "active",
                            presentation = activated.Presentation,
                        },
                        JsonOptions);
                }
                catch (UnauthorizedAccessException)
                {
                    return Error(
                        StatusCodes.Status401Unauthorized,
                        "Presenter session is invalid.",
                        "session_invalid");
                }
                catch (InvalidOperationException)
                {
                    return Error(
                        StatusCodes.Status409Conflict,
                        "Presentation confirmation does not match.",
                        "binding_mismatch");
                }
                catch (OperationCanceledException) when (
                    context.RequestAborted.IsCancellationRequested)
                {
                    throw;
                }
                catch
                {
                    var failed = sessions.Find(sessionToken, origin);
                    sessions.Disconnect(sessionToken, origin);
                    if (activationHandler is not null &&
                        failed is not null &&
                        failed.Claims.ConnectionId != Guid.Empty)
                    {
                        using var stopTimeout = new CancellationTokenSource(
                            TimeSpan.FromSeconds(3));
                        try
                        {
                            await activationHandler.DisconnectAsync(
                                failed.Claims.ConnectionId,
                                stopTimeout.Token);
                        }
                        catch
                        {
                        }
                    }
                    return Error(
                        StatusCodes.Status409Conflict,
                        "Presenter activation could not be completed.",
                        "remote_claim_failed");
                }
                finally
                {
                    activationGate.Release();
                }
            }

            if (!limiter.TryAcquire())
            {
                return Error(
                    StatusCodes.Status429TooManyRequests,
                    "Too many pairing attempts.",
                    "pairing_rate_limited");
            }

            var requestedPageCount = request?.PdfPageCount;
            if (request?.LectureSessionId is null ||
                request.LectureSessionId == Guid.Empty ||
                !LoopbackRequestGuard.IsValidTicket(request.Ticket) ||
                !LoopbackRequestGuard.IsValidDocumentId(request.PdfDocumentId) ||
                !LoopbackRequestGuard.IsValidDocumentVersion(
                    request.PdfDocumentVersion) ||
                requestedPageCount is null or < 1 or > 75)
            {
                return Error(
                    StatusCodes.Status400BadRequest,
                    "Pairing request is invalid.",
                    "pairing_invalid");
            }

            var claims = await ticketVerifier.VerifyAndConsumeAsync(
                request.Ticket!,
                request.LectureSessionId.Value,
                request.PdfDocumentId!,
                request.PdfDocumentVersion!,
                requestedPageCount.Value,
                origin,
                context.RequestAborted);
            if (claims is null || claims.ExpiresAt <= DateTimeOffset.UtcNow)
            {
                return Error(
                    StatusCodes.Status401Unauthorized,
                    "Pairing ticket is invalid or expired.",
                    "ticket_invalid");
            }

            PresentationObservation? observation;
            try
            {
                observation = await presentationSource.ObserveAsync(
                    context.RequestAborted);
            }
            catch (InvalidOperationException)
            {
                return Error(
                    StatusCodes.Status409Conflict,
                    "PowerPoint slide show is unavailable.",
                    PresenterIssueCodes.MultipleSlideShows);
            }

            if (observation is null)
            {
                return Error(
                    StatusCodes.Status409Conflict,
                    "PowerPoint slide show is unavailable.",
                    PresenterIssueCodes.PowerPointNotRunning);
            }

            var eligibility = PresentationEligibilityEvaluator.Evaluate(
                observation,
                claims.PdfPageCount);
            var presentation = new PresentationResponse(
                observation.DeckBindingDigest,
                observation.DisplayName,
                observation.SlideCount,
                observation.CurrentSlideIndex,
                eligibility.Eligible,
                eligibility.Issues);
            PresenterLoopbackSessions.Session session;
            try
            {
                session = sessions.Create(origin, claims, presentation);
            }
            catch (InvalidOperationException)
            {
                return Error(
                    StatusCodes.Status409Conflict,
                    "A Presenter connection is already active.",
                    "connector_conflict");
            }

            return Results.Json(
                new ConnectResponse(
                    true,
                    "pending_confirmation",
                    session.Token,
                    presentation),
                JsonOptions);
        });

        app.MapGet("/v1/presentation", async (HttpContext context) =>
        {
            var session = GetSession(context, sessions);
            if (session is null)
            {
                return Error(
                    StatusCodes.Status401Unauthorized,
                    "Presenter session is invalid.",
                    "session_invalid");
            }

            var observation = await presentationSource.ObserveAsync(
                context.RequestAborted);
            if (observation is null ||
                observation.DeckBindingDigest !=
                    session.Presentation.BindingDigest)
            {
                return Error(
                    StatusCodes.Status409Conflict,
                    "Presentation changed after pairing.",
                    PresenterIssueCodes.PresentationChanged);
            }

            var eligibility = PresentationEligibilityEvaluator.Evaluate(
                observation,
                session.Claims.PdfPageCount);
            var presentation = new PresentationResponse(
                observation.DeckBindingDigest,
                observation.DisplayName,
                observation.SlideCount,
                observation.CurrentSlideIndex,
                eligibility.Eligible,
                eligibility.Issues);
            return Results.Json(
                new PresentationEnvelope(true, presentation),
                JsonOptions);
        });

        app.MapGet("/v1/status", (HttpContext context) =>
        {
            var session = GetSession(context, sessions);
            return session is null
                ? Error(
                    StatusCodes.Status401Unauthorized,
                    "Presenter session is invalid.",
                    "session_invalid")
                : Results.Json(
                    new StatusResponse(
                        true,
                        session.State,
                        session.Presentation,
                        session.LastErrorCode),
                    JsonOptions);
        });

        app.MapPost("/v1/disconnect", async (HttpContext context) =>
        {
            var origin = context.Request.Headers.Origin.ToString();
            var token = context.Request.Headers[SessionHeader].ToString();
            var session = sessions.Find(token, origin);
            if (session is null || !sessions.Disconnect(token, origin))
            {
                return Error(
                    StatusCodes.Status401Unauthorized,
                    "Presenter session is invalid.",
                    "session_invalid");
            }

            if (activationHandler is not null &&
                session.Claims.ConnectionId != Guid.Empty)
            {
                using var stopTimeout = new CancellationTokenSource(
                    TimeSpan.FromSeconds(3));
                try
                {
                    await activationHandler.DisconnectAsync(
                        session.Claims.ConnectionId,
                        stopTimeout.Token);
                }
                catch
                {
                    // Local revocation is authoritative for browser handover;
                    // the remote heartbeat/expiry path remains fail closed.
                }
            }

            return Results.Json(
                new StateResponse(true, "disconnected"),
                JsonOptions);
        });

        app.MapFallback(() => Error(
            StatusCodes.Status404NotFound,
            "Endpoint was not found.",
            "not_found"));

        await app.StartAsync(cancellationToken);
        var faultSource = activationHandler as IPresenterSessionFaultSource;
        EventHandler<PresenterSessionFaultedEventArgs>? faultHandler = null;
        if (faultSource is not null)
        {
            faultHandler = (_, fault) =>
                sessions.MarkFaulted(fault.ConnectionId, fault.ErrorCode);
            faultSource.SessionFaulted += faultHandler;
        }

        return new LoopbackPresenterServer(
            app,
            activationGate,
            sessions,
            faultSource,
            faultHandler);
    }

    public async ValueTask DisposeAsync()
    {
        if (faultSource is not null && faultHandler is not null)
        {
            faultSource.SessionFaulted -= faultHandler;
        }
        await application.StopAsync();
        await application.DisposeAsync();
        activationGate.Dispose();
    }

    private static PresenterLoopbackSessions.Session? GetSession(
        HttpContext context,
        PresenterLoopbackSessions sessions) =>
        sessions.Find(
            context.Request.Headers[SessionHeader].ToString(),
            context.Request.Headers.Origin.ToString());

    private static IResult Error(int status, string message, string code) =>
        Results.Json(
            new ErrorResponse(false, message, code),
            JsonOptions,
            statusCode: status);

    private static async Task WriteErrorAsync(
        HttpContext context,
        int status,
        string message,
        string code)
    {
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Headers.CacheControl = "no-store";
        await context.Response.WriteAsJsonAsync(
            new ErrorResponse(false, message, code),
            JsonOptions);
    }
}
