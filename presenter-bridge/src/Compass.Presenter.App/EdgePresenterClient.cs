using System.Buffers;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Compass.Presenter.Contracts;
using Compass.Presenter.Loopback;

namespace Compass.Presenter.App;

internal sealed class EdgePresenterClient : IDisposable
{
    private const int MaximumResponseBytes = 64 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new(
        JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    private readonly Uri endpoint;
    private readonly HttpClient httpClient;

    public EdgePresenterClient(Uri endpoint)
    {
        this.endpoint = endpoint;
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.None,
            ConnectTimeout = TimeSpan.FromSeconds(3),
            PooledConnectionLifetime = TimeSpan.FromMinutes(10),
            UseCookies = false,
        };
        httpClient = new HttpClient(handler)
        {
            Timeout = Timeout.InfiniteTimeSpan,
        };
        httpClient.DefaultRequestHeaders.UserAgent.ParseAdd(
            "COMPASS-PresenterBridge/1");
    }

    public async ValueTask<PairingTicketClaims?> InspectPairingAsync(
        string ticket,
        Guid lectureSessionId,
        string pdfDocumentId,
        string pdfDocumentVersion,
        int pdfPageCount,
        string origin,
        string installationHash,
        PresentationObservation observation,
        CancellationToken cancellationToken)
    {
        if (!PresenterPairingTokenMetadata.HasExactOrigin(ticket, origin))
        {
            return null;
        }

        var response = await PostAsync<InspectResponse>(
            new
            {
                action = "inspect",
                pairingTicket = ticket,
                installationHash,
                pptxFileSha256 = observation.PptxFileSha256,
                slideIdOrderSha256 = observation.SlideIdOrderSha256,
                slideCount = observation.SlideCount,
                hiddenSlideCount = observation.HiddenSlideCount,
                customShowActive =
                    observation.RangeMode != PresentationRangeMode.AllSlides,
            },
            cancellationToken).ConfigureAwait(false);
        if (!response.Ok ||
            response.ConnectionId == Guid.Empty ||
            response.LectureSessionId != lectureSessionId ||
            response.PdfDocumentId != pdfDocumentId ||
            response.PdfDocumentVersion != pdfDocumentVersion ||
            response.PdfPageCount != pdfPageCount ||
            response.State is not ("inspected" or "confirmed") ||
            response.TicketExpiresAt <= DateTimeOffset.UtcNow ||
            response.HardStopAt <= DateTimeOffset.UtcNow)
        {
            return null;
        }

        return new PairingTicketClaims(
            response.LectureSessionId,
            response.PdfDocumentId,
            response.PdfDocumentVersion,
            response.PdfPageCount,
            response.TicketExpiresAt)
        {
            ConnectionId = response.ConnectionId,
            HardStopAt = response.HardStopAt,
            PairingCredential = ticket,
        };
    }

    public async ValueTask<PresenterCapability> ClaimAsync(
        PairingTicketClaims claims,
        string installationHash,
        CancellationToken cancellationToken)
    {
        if (claims.ConnectionId == Guid.Empty ||
            string.IsNullOrEmpty(claims.PairingCredential))
        {
            throw new PresenterRemoteException("pairing_credential_unavailable");
        }

        var response = await PostAsync<ClaimResponse>(
            new
            {
                action = "claim",
                pairingTicket = claims.PairingCredential,
                installationHash,
            },
            cancellationToken).ConfigureAwait(false);
        if (!response.Ok ||
            response.ConnectionId != claims.ConnectionId ||
            response.LectureSessionId != claims.LectureSessionId ||
            response.State != "active" ||
            response.CapabilityExpiresAt <= DateTimeOffset.UtcNow ||
            !PresenterPairingTokenMetadata.IsTokenSyntax(
                response.CapabilityToken))
        {
            throw new PresenterRemoteException("capability_invalid");
        }

        return new PresenterCapability(
            response.ConnectionId,
            response.LectureSessionId,
            response.CapabilityToken,
            response.CapabilityExpiresAt);
    }

    public async ValueTask<PageCommitResult> UpdatePageAsync(
        PresenterCapability capability,
        string installationHash,
        string pptxFileSha256,
        string slideIdOrderSha256,
        PageUpdateEnvelope update,
        CancellationToken cancellationToken)
    {
        var response = await PostAsync<UpdateResponse>(
            new
            {
                action = "update",
                capabilityToken = capability.Token,
                installationHash,
                eventId = update.EventId,
                sequence = update.Sequence,
                pptxFileSha256,
                slideIdOrderSha256,
                slideId = update.State.SlideId,
                slideIndex = update.State.PageNumber,
                pdfPage = update.State.PageNumber,
            },
            cancellationToken).ConfigureAwait(false);
        if (!response.Ok)
        {
            throw new PresenterRemoteException("page_update_invalid");
        }
        if (!response.Accepted)
        {
            throw new PresenterRemoteException(
                NormalizeRemoteReason(response.Reason),
                response.Reason == "rate_limited");
        }
        return new PageCommitResult(
            response.Changed ?? false,
            response.CurrentPdfPage ?? update.State.PageNumber);
    }

    public async ValueTask<HeartbeatResult> HeartbeatAsync(
        PresenterCapability capability,
        string installationHash,
        string pptxFileSha256,
        string slideIdOrderSha256,
        CancellationToken cancellationToken)
    {
        var response = await PostAsync<HeartbeatResponse>(
            new
            {
                action = "heartbeat",
                capabilityToken = capability.Token,
                installationHash,
                pptxFileSha256,
                slideIdOrderSha256,
            },
            cancellationToken).ConfigureAwait(false);
        return new HeartbeatResult(
            response.Ok && response.Active,
            response.Reason is null ? null : NormalizeRemoteReason(response.Reason));
    }

    public async ValueTask DisconnectAsync(
        PresenterCapability capability,
        CancellationToken cancellationToken)
    {
        var response = await PostAsync<DisconnectResponse>(
            new
            {
                action = "disconnect",
                capabilityToken = capability.Token,
            },
            cancellationToken).ConfigureAwait(false);
        if (!response.Ok || response.State != "revoked")
        {
            throw new PresenterRemoteException("disconnect_rejected");
        }
    }

    public void Dispose() => httpClient.Dispose();

    private async ValueTask<T> PostAsync<T>(
        object body,
        CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        var payload = JsonSerializer.SerializeToUtf8Bytes(body, JsonOptions);
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
            {
                Content = new ByteArrayContent(payload),
            };
            request.Content.Headers.ContentType = new MediaTypeHeaderValue(
                "application/json")
            {
                CharSet = "utf-8",
            };
            request.Headers.CacheControl = new CacheControlHeaderValue
            {
                NoCache = true,
                NoStore = true,
            };
            using var response = await httpClient.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                timeout.Token).ConfigureAwait(false);
            if ((int)response.StatusCode is >= 300 and < 400)
            {
                throw new PresenterRemoteException("redirect_rejected");
            }
            if (!response.IsSuccessStatusCode)
            {
                var transient = response.StatusCode is
                    HttpStatusCode.RequestTimeout or
                    HttpStatusCode.TooManyRequests or
                    HttpStatusCode.BadGateway or
                    HttpStatusCode.ServiceUnavailable or
                    HttpStatusCode.GatewayTimeout;
                throw new PresenterRemoteException(
                    "remote_request_rejected",
                    transient);
            }
            if (response.Content.Headers.ContentType?.MediaType !=
                    "application/json" ||
                response.Headers.CacheControl?.NoStore != true ||
                response.Content.Headers.ContentLength is > MaximumResponseBytes)
            {
                throw new PresenterRemoteException("remote_response_invalid");
            }

            var bytes = await ReadBoundedAsync(
                response.Content,
                timeout.Token).ConfigureAwait(false);
            try
            {
                return JsonSerializer.Deserialize<T>(bytes, JsonOptions) ??
                    throw new PresenterRemoteException("remote_response_invalid");
            }
            catch (JsonException)
            {
                throw new PresenterRemoteException("remote_response_invalid");
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new PresenterRemoteException("remote_timeout", transient: true);
        }
        catch (HttpRequestException)
        {
            throw new PresenterRemoteException("remote_unavailable", transient: true);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(payload);
        }
    }

    private static async Task<byte[]> ReadBoundedAsync(
        HttpContent content,
        CancellationToken cancellationToken)
    {
        await using var stream = await content.ReadAsStreamAsync(cancellationToken)
            .ConfigureAwait(false);
        var writer = new ArrayBufferWriter<byte>();
        var buffer = ArrayPool<byte>.Shared.Rent(8 * 1024);
        try
        {
            while (true)
            {
                var read = await stream.ReadAsync(
                    buffer.AsMemory(0, buffer.Length),
                    cancellationToken).ConfigureAwait(false);
                if (read == 0)
                {
                    return writer.WrittenSpan.ToArray();
                }
                if (writer.WrittenCount + read > MaximumResponseBytes)
                {
                    throw new PresenterRemoteException("remote_response_too_large");
                }
                writer.Write(buffer.AsSpan(0, read));
            }
        }
        finally
        {
            CryptographicOperations.ZeroMemory(buffer);
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static string NormalizeRemoteReason(string? reason) =>
        reason is not null &&
        reason.Length is >= 1 and <= 80 &&
        reason.All(character =>
            char.IsAsciiLetterOrDigit(character) || character is '_' or '-')
            ? reason
            : "remote_rejected";

    private sealed record InspectResponse
    {
        [JsonPropertyName("ok")]
        public bool Ok { get; init; }

        [JsonPropertyName("connection_id")]
        public Guid ConnectionId { get; init; }

        [JsonPropertyName("hard_stop_at")]
        public DateTimeOffset HardStopAt { get; init; }

        [JsonPropertyName("lecture_session_id")]
        public Guid LectureSessionId { get; init; }

        [JsonPropertyName("pdf_document_id")]
        public string PdfDocumentId { get; init; } = string.Empty;

        [JsonPropertyName("pdf_document_version")]
        public string PdfDocumentVersion { get; init; } = string.Empty;

        [JsonPropertyName("pdf_manifest_version")]
        public long PdfManifestVersion { get; init; }

        [JsonPropertyName("pdf_page_count")]
        public int PdfPageCount { get; init; }

        [JsonPropertyName("state")]
        public string State { get; init; } = string.Empty;

        [JsonPropertyName("ticket_expires_at")]
        public DateTimeOffset TicketExpiresAt { get; init; }
    }

    private sealed record ClaimResponse(
        bool Ok,
        Guid ConnectionId,
        Guid LectureSessionId,
        string State,
        string CapabilityToken,
        DateTimeOffset CapabilityExpiresAt);

    private sealed record UpdateResponse
    {
        public bool Ok { get; init; }
        public bool Accepted { get; init; }
        public string? Reason { get; init; }
        public bool? Changed { get; init; }

        [JsonPropertyName("current_pdf_page")]
        public int? CurrentPdfPage { get; init; }

        [JsonPropertyName("display_version")]
        public long? DisplayVersion { get; init; }

        [JsonPropertyName("idempotent_replay")]
        public bool? IdempotentReplay { get; init; }

        [JsonPropertyName("pdf_version")]
        public long? PdfVersion { get; init; }

        [JsonPropertyName("state_version")]
        public long? StateVersion { get; init; }
    }

    private sealed record HeartbeatResponse
    {
        public bool Ok { get; init; }
        public bool Active { get; init; }
        public string? Reason { get; init; }

        [JsonPropertyName("current_pdf_page")]
        public int? CurrentPdfPage { get; init; }

        [JsonPropertyName("hard_stop_at")]
        public DateTimeOffset? HardStopAt { get; init; }

        [JsonPropertyName("last_sequence")]
        public long? LastSequence { get; init; }

        [JsonPropertyName("pdf_document_id")]
        public string? PdfDocumentId { get; init; }

        [JsonPropertyName("pdf_document_version")]
        public string? PdfDocumentVersion { get; init; }
    }

    private sealed record DisconnectResponse
    {
        public bool Ok { get; init; }
        public string State { get; init; } = string.Empty;

        [JsonPropertyName("connection_id")]
        public Guid ConnectionId { get; init; }

        [JsonPropertyName("revoke_reason")]
        public string? RevokeReason { get; init; }

        [JsonPropertyName("revoked_at")]
        public DateTimeOffset? RevokedAt { get; init; }
    }
}

internal sealed record PresenterCapability(
    Guid ConnectionId,
    Guid LectureSessionId,
    string Token,
    DateTimeOffset ExpiresAt)
{
    public override string ToString() =>
        "PresenterCapability { Token = [redacted] }";
}

internal sealed record PageCommitResult(bool Changed, int CurrentPdfPage);

internal sealed record HeartbeatResult(bool Active, string? Reason);

internal sealed class PresenterRemoteException : Exception
{
    public PresenterRemoteException(string code, bool transient = false)
        : base("Presenter service request failed.")
    {
        Code = code;
        Transient = transient;
    }

    public string Code { get; }

    public bool Transient { get; }
}

internal static class PresenterPairingTokenMetadata
{
    public static bool HasExactOrigin(string ticket, string expectedOrigin)
    {
        try
        {
            var separator = ticket.IndexOf('.');
            if (separator <= 0 || separator != ticket.LastIndexOf('.'))
            {
                return false;
            }
            var payload = DecodeBase64Url(ticket.AsSpan(0, separator));
            using var document = JsonDocument.Parse(payload);
            return document.RootElement.TryGetProperty("origin", out var origin) &&
                origin.ValueKind == JsonValueKind.String &&
                string.Equals(
                    origin.GetString(),
                    expectedOrigin,
                    StringComparison.Ordinal);
        }
        catch (FormatException)
        {
            return false;
        }
        catch (JsonException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    public static bool IsTokenSyntax(string? token) =>
        token is not null &&
        token.Length is >= 60 and <= 4096 &&
        token.Count(character => character == '.') == 1 &&
        token.All(character =>
            char.IsAsciiLetterOrDigit(character) ||
            character is '_' or '-' or '.');

    private static byte[] DecodeBase64Url(ReadOnlySpan<char> encoded)
    {
        var value = encoded.ToString().Replace('-', '+').Replace('_', '/');
        value = value.PadRight(value.Length + ((4 - value.Length % 4) % 4), '=');
        return Convert.FromBase64String(value);
    }
}
