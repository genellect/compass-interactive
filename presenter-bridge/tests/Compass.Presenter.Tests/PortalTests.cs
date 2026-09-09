using Compass.Presenter.App;

namespace Compass.Presenter.Tests;

internal static class PortalTests
{
    public static Task BackgroundLaunchDoesNotOpenTheBrowser()
    {
        Assert.True(PresenterPortal.ShouldOpenOnLaunch([]));
        Assert.False(PresenterPortal.ShouldOpenOnLaunch(["--background"]));
        Assert.False(PresenterPortal.ShouldOpenOnLaunch(["--background", "ignored"]));
        // URL-like arguments cannot become a browser destination.
        Assert.True(PresenterPortal.ShouldOpenOnLaunch(["https://example.invalid/"]));
        Assert.Equal("https://compass-interactive.pages.dev/admin/", PresenterPortal.TeacherUrl);
        Assert.Equal("https://compass-interactive.pages.dev/presenter-bridge/index.html", PresenterPortal.GuideUrl);
        return Task.CompletedTask;
    }
}
