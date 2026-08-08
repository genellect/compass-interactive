using System.Net;
using System.Text.RegularExpressions;

namespace Compass.Presenter.Loopback;

public sealed partial class LoopbackRequestGuard
{
    private const int MaximumRequestBytes = 8 * 1024;
    private readonly HashSet<string> allowedOrigins;

    public LoopbackRequestGuard(IEnumerable<string> allowedOrigins)
    {
        this.allowedOrigins = allowedOrigins
            .Select(origin => origin.Trim())
            .Where(origin => origin.Length > 0)
            .ToHashSet(StringComparer.Ordinal);
        if (this.allowedOrigins.Count == 0 ||
            this.allowedOrigins.Any(origin =>
                !Uri.TryCreate(origin, UriKind.Absolute, out var uri) ||
                (uri.Scheme != Uri.UriSchemeHttps &&
                    !IsLoopbackDevelopmentOrigin(uri)) ||
                uri.PathAndQuery != "/"))
        {
            throw new ArgumentException(
                "Allowed Origins must be exact HTTPS origins or loopback development origins.",
                nameof(allowedOrigins));
        }
    }

    public string? ValidateConnection(HttpContext context)
    {
        var remoteAddress = context.Connection.RemoteIpAddress;
        if (remoteAddress is null || !IPAddress.IsLoopback(remoteAddress))
        {
            return "remote_address_not_loopback";
        }

        var expectedHost = $"127.0.0.1:{context.Connection.LocalPort}";
        if (!string.Equals(
            context.Request.Host.Value,
            expectedHost,
            StringComparison.Ordinal))
        {
            return "host_not_allowed";
        }

        var origin = context.Request.Headers.Origin.ToString();
        if (!allowedOrigins.Contains(origin))
        {
            return "origin_not_allowed";
        }

        return null;
    }

    public string? ValidateJsonPost(HttpRequest request)
    {
        if (!HttpMethods.IsPost(request.Method))
        {
            return "method_not_allowed";
        }

        if (request.ContentLength is < 1 or > MaximumRequestBytes)
        {
            return "body_size_invalid";
        }

        if (request.Headers.TransferEncoding.Count > 0)
        {
            return "transfer_encoding_not_allowed";
        }

        var mediaType = request.ContentType?.Split(';', 2)[0].Trim();
        if (!string.Equals(
            mediaType,
            "application/json",
            StringComparison.OrdinalIgnoreCase))
        {
            return "content_type_invalid";
        }

        return null;
    }

    public static bool IsValidTicket(string? ticket) =>
        ticket is not null && TicketPattern().IsMatch(ticket);

    public static bool IsValidDocumentId(string? documentId) =>
        documentId is not null && DocumentIdPattern().IsMatch(documentId);

    public static bool IsValidDocumentVersion(string? version) =>
        version is not null && Sha256Pattern().IsMatch(version);

    private static bool IsLoopbackDevelopmentOrigin(Uri uri) =>
        uri.Scheme == Uri.UriSchemeHttp &&
        (uri.Host == "127.0.0.1" || uri.Host == "localhost") &&
        uri.Port is >= 1024 and <= 65535;

    [GeneratedRegex(
        "^[A-Za-z0-9_-]{16,2048}\\.[A-Za-z0-9_-]{43}$",
        RegexOptions.CultureInvariant)]
    private static partial Regex TicketPattern();

    [GeneratedRegex(
        "^[a-z0-9][a-z0-9-]{0,63}$",
        RegexOptions.CultureInvariant)]
    private static partial Regex DocumentIdPattern();

    [GeneratedRegex("^[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex Sha256Pattern();
}
