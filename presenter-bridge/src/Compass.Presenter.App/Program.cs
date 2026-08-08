using System.Runtime.Versioning;
using Compass.Presenter.Loopback;
using Compass.Presenter.PowerPoint.External;

namespace Compass.Presenter.App;

internal static class Program
{
    [STAThread]
    [SupportedOSPlatform("windows10.0.19041")]
    private static async Task<int> Main()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041))
        {
            return 2;
        }

        using var singleInstance = SingleInstanceLease.TryAcquire();
        if (singleInstance is null)
        {
            return 0;
        }

        BridgeOptions options;
        string installationHash;
        try
        {
            options = BridgeOptions.Load();
            installationHash = WindowsInstallationIdentity.GetOrCreateHash();
        }
        catch
        {
            ShowSafeStartupError();
            return 3;
        }

        var shutdown = new TaskCompletionSource(
            TaskCreationOptions.RunContinuationsAsynchronously);
        EventHandler processExit = (_, _) => shutdown.TrySetResult();
        ConsoleCancelEventHandler cancel = (_, args) =>
        {
            args.Cancel = true;
            shutdown.TrySetResult();
        };
        AppDomain.CurrentDomain.ProcessExit += processExit;
        Console.CancelKeyPress += cancel;

        await using var presentationSource =
            new PowerPointComObservationSource();
        using var remoteClient = new EdgePresenterClient(
            options.PresenterSessionEndpoint);
        await using var coordinator = new PresenterSessionCoordinator(
            remoteClient,
            presentationSource,
            installationHash);
        var verifier = new EdgePairingTicketVerifier(
            remoteClient,
            presentationSource,
            installationHash);

        LoopbackPresenterServer? server = null;
        try
        {
            server = await LoopbackPresenterServer.StartAsync(
                options.AllowedOrigins,
                verifier,
                presentationSource,
                coordinator,
                port: LoopbackPresenterServer.DefaultPort,
                pairingAttemptsPerMinute: 5).ConfigureAwait(false);
            await shutdown.Task.ConfigureAwait(false);
            return 0;
        }
        catch
        {
            ShowSafeStartupError();
            return 4;
        }
        finally
        {
            AppDomain.CurrentDomain.ProcessExit -= processExit;
            Console.CancelKeyPress -= cancel;
            if (server is not null)
            {
                await server.DisposeAsync().ConfigureAwait(false);
            }
        }
    }

    private static void ShowSafeStartupError()
    {
        System.Windows.Forms.MessageBox.Show(
            "Presenter Bridge を開始できませんでした。設定と既存プロセスを確認してください。",
            "COMPASS Presenter Bridge",
            System.Windows.Forms.MessageBoxButtons.OK,
            System.Windows.Forms.MessageBoxIcon.Error);
    }
}
