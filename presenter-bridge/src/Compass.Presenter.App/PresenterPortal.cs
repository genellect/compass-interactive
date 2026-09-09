using System.Diagnostics;
using System.Runtime.Versioning;

namespace Compass.Presenter.App;

// Open only fixed, credential-free product URLs in the existing browser.
// The native app never introduces another login or accepts a URL argument.
internal static class PresenterPortal
{
    internal const string TeacherUrl = "https://compass-interactive.pages.dev/admin/";
    internal const string GuideUrl = "https://compass-interactive.pages.dev/presenter-bridge/index.html";

    internal static bool ShouldOpenOnLaunch(string[] args) =>
        !args.Contains("--background", StringComparer.Ordinal);

    [SupportedOSPlatform("windows10.0.19041")]
    internal static void OpenTeacher() => Open(TeacherUrl);
    [SupportedOSPlatform("windows10.0.19041")]
    internal static void OpenGuide() => Open(GuideUrl);

    [SupportedOSPlatform("windows10.0.19041")]
    private static void Open(string url)
    {
        try
        {
            using var browser = Process.Start(new ProcessStartInfo(url)
            {
                UseShellExecute = true,
            });
        }
        catch
        {
            MessageBox.Show(
                "ブラウザを開けませんでした。いつものブラウザで次のページを開いてください。\n\n" + url,
                "COMPASS Presenter Bridge",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }
    }
}
