using Compass.Presenter.App;

namespace Compass.Presenter.Tests;

internal static class SecurityTests
{
    public static Task EndpointIsPinnedToCanonicalHost()
    {
        var accepted = BridgeOptions.ValidatePresenterEndpoint(
            "https://pfvedtqccblecuyjlfqh.supabase.co/functions/v1/presenter-bridge-session");
        Assert.Equal("pfvedtqccblecuyjlfqh.supabase.co", accepted.Host);

        Assert.Throws<InvalidOperationException>(() =>
            BridgeOptions.ValidatePresenterEndpoint(
                "https://evil.example/functions/v1/presenter-bridge-session"));
        Assert.Throws<InvalidOperationException>(() =>
            BridgeOptions.ValidatePresenterEndpoint(
                "https://pfvedtqccblecuyjlfqh.supabase.co:444/functions/v1/presenter-bridge-session"));
        Assert.Throws<InvalidOperationException>(() =>
            BridgeOptions.ValidatePresenterEndpoint(
                "https://user@pfvedtqccblecuyjlfqh.supabase.co/functions/v1/presenter-bridge-session"));
        return Task.CompletedTask;
    }
}
