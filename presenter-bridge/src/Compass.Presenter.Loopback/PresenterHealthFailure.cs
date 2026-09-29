using System.Text.Json;

namespace Compass.Presenter.Loopback;

// Keep this boundary independent of Core: a blocked assembly can fail during
// JIT compilation, before the readiness probe's own catch is entered.
internal static class PresenterHealthFailure
{
    internal static bool IsInstallationBlocked(Exception error) =>
        error is FileLoadException && error.HResult == unchecked((int)0x800711C7);

    internal static async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        try
        {
            await next(context);
        }
        catch (Exception error) when (
            IsInstallationBlocked(error) && !context.Response.HasStarted)
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            context.Response.Headers.CacheControl = "no-store";
            await context.Response.WriteAsJsonAsync(
                new ErrorResponse(false,
                    "Windows blocked Presenter Bridge execution.",
                    "bridge_installation_blocked"),
                new JsonSerializerOptions(JsonSerializerDefaults.Web));
        }
    }
}
