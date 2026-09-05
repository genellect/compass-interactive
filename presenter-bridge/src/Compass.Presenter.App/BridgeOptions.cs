namespace Compass.Presenter.App;

internal sealed record BridgeOptions(
    Uri PresenterSessionEndpoint,
    IReadOnlyList<string> AllowedOrigins)
{
    private const string CanonicalOrigin =
        "https://compass-interactive.pages.dev";
    internal const string ProductionPresenterEndpoint =
        "https://presenter-api.yuto-matsui.com/functions/v1/presenter-bridge-session";
    private const string CanonicalEndpointHost =
        "presenter-api.yuto-matsui.com";
    private const string EndpointVariable =
        "COMPASS_PRESENTER_SESSION_ENDPOINT";
    private const string OriginsVariable =
        "COMPASS_PRESENTER_ALLOWED_ORIGINS";

    public static BridgeOptions Load()
    {
#if DEBUG
        var endpointText = Environment.GetEnvironmentVariable(EndpointVariable);
        endpointText = string.IsNullOrWhiteSpace(endpointText)
            ? ProductionPresenterEndpoint
            : endpointText;
#else
        var endpointText = ProductionPresenterEndpoint;
#endif
        var endpoint = ValidatePresenterEndpoint(endpointText);
#if DEBUG
        var configuredOrigins = Environment.GetEnvironmentVariable(OriginsVariable);
        string[] origins = string.IsNullOrWhiteSpace(configuredOrigins)
            ? [CanonicalOrigin]
            : configuredOrigins.Split(
                ';',
                StringSplitOptions.RemoveEmptyEntries |
                    StringSplitOptions.TrimEntries);
#else
        string[] origins = [CanonicalOrigin];
#endif
        if (origins.Length == 0 || origins.Distinct(StringComparer.Ordinal).Count() !=
            origins.Length)
        {
            throw new InvalidOperationException(
                $"{OriginsVariable} contains duplicate or empty entries.");
        }

        foreach (var origin in origins)
        {
            if (!Uri.TryCreate(origin, UriKind.Absolute, out var parsed) ||
                (parsed.Scheme != Uri.UriSchemeHttps &&
                    !IsLoopbackDevelopmentOrigin(parsed)) ||
                parsed.GetLeftPart(UriPartial.Authority) != origin)
            {
                throw new InvalidOperationException(
                    $"{OriginsVariable} must contain exact origins only.");
            }
        }

        return new BridgeOptions(endpoint, origins);
    }

    internal static Uri ValidatePresenterEndpoint(string? endpointText)
    {
        if (!Uri.TryCreate(endpointText, UriKind.Absolute, out var endpoint) ||
            endpoint.Scheme != Uri.UriSchemeHttps ||
            !endpoint.IsDefaultPort ||
            !string.Equals(
                endpoint.IdnHost,
                CanonicalEndpointHost,
                StringComparison.OrdinalIgnoreCase) ||
            !string.IsNullOrEmpty(endpoint.UserInfo) ||
            !string.IsNullOrEmpty(endpoint.Query) ||
            !string.IsNullOrEmpty(endpoint.Fragment) ||
            !string.Equals(
                endpoint.AbsolutePath,
                "/functions/v1/presenter-bridge-session",
                StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"{EndpointVariable} must be the exact canonical HTTPS Presenter session endpoint.");
        }

        return endpoint;
    }

    private static bool IsLoopbackDevelopmentOrigin(Uri uri) =>
        uri.Scheme == Uri.UriSchemeHttp &&
        (uri.Host == "127.0.0.1" || uri.Host == "localhost") &&
        uri.Port is >= 1024 and <= 65535;
}
