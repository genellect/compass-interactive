using System.Runtime.Versioning;
using Compass.Presenter.Loopback;
using Compass.Presenter.PowerPoint.External;
using Velopack;

namespace Compass.Presenter.App;

internal static class Program
{
    [STAThread]
    [SupportedOSPlatform("windows10.0.19041")]
    private static async Task<int> Main(string[] args)
    {
        VelopackApp.Build()
            .SetArgs(args)
            .SetAutoApplyOnStartup(false)
            .Run();

        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041))
        {
            return 2;
        }

        using var singleInstance = SingleInstanceLease.TryAcquire();
        if (singleInstance is null)
        {
            return 0;
        }

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);

        BridgeOptions options;
        WindowsInstallationProof installationProof;
        try
        {
            options = BridgeOptions.Load();
            try
            {
                installationProof = WindowsInstallationProof.GetOrCreate();
            }
            catch (InstallationProofException)
            {
                if (!ConfirmInstallationProofRepair())
                {
                    return 3;
                }
                installationProof =
                    WindowsInstallationProof.RepairAndRecreate();
            }
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

        using var activityGate = new SemaphoreSlim(1, 1);
        using var updateLifetime = new CancellationTokenSource();
        await using var presentationSource =
            new PowerPointComObservationSource();
        using var installationProofLifetime = installationProof;
        using var remoteClient = new EdgePresenterClient(
            options.PresenterSessionEndpoint,
            installationProof);
        await using var coordinator = new PresenterSessionCoordinator(
            remoteClient,
            presentationSource,
            installationProof.KeyId);
        var verifier = new EdgePairingTicketVerifier(
            remoteClient,
            presentationSource,
            installationProof.KeyId);
        var manualRecovery = new ManualRecoveryService(
            remoteClient,
            coordinator,
            presentationSource,
            installationProof.KeyId,
            activityGate);

        LoopbackPresenterServer? server = null;
        try
        {
            server = await LoopbackPresenterServer.StartAsync(
                options.AllowedOrigins,
                verifier,
                presentationSource,
                coordinator,
                port: LoopbackPresenterServer.DefaultPort,
                pairingAttemptsPerMinute: 5,
                activityGate: activityGate).ConfigureAwait(false);
            using var updateProvider = VelopackPresenterUpdater.TryCreate();
            var updates = updateProvider is null ? null : new PresenterUpdateCoordinator(
                activityGate,
                () => server.HasLiveSession,
                coordinator.TryRunWhenIdleAsync,
                updateProvider);
            await using var tray = await PresenterTrayHost.StartAsync(
                manualRecovery.RecoverAsync,
                () => shutdown.TrySetResult(),
                updates is null ? null : updates.CheckAsync,
                updates is null ? null : updates.InstallAsync).ConfigureAwait(false);
            EventHandler<PresenterSessionStateChangedEventArgs> stateChanged =
                (_, eventArgs) => tray.ReportSessionState(eventArgs.State);
            coordinator.SessionStateChanged += stateChanged;
            if (updates is not null)
            {
                updates.AvailabilityChanged += tray.ReportUpdateAvailability;
            }
            var updateCheck = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(30), updateLifetime.Token)
                        .ConfigureAwait(false);
                    if (updates is not null)
                    {
                        await updates.CheckAsync(updateLifetime.Token).ConfigureAwait(false);
                    }
                }
                catch
                {
                    // Update availability never interrupts a lecture or startup.
                }
            });
            try
            {
                tray.ReportSessionState(coordinator.SessionState);
                await shutdown.Task.ConfigureAwait(false);
            }
            finally
            {
                updateLifetime.Cancel();
                await updateCheck.ConfigureAwait(false);
                coordinator.SessionStateChanged -= stateChanged;
                if (updates is not null)
                {
                    updates.AvailabilityChanged -= tray.ReportUpdateAvailability;
                }
            }
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

    private static bool ConfirmInstallationProofRepair() =>
        System.Windows.Forms.MessageBox.Show(
            "ローカル接続IDを再作成します。既存のPowerPoint接続は再ペアリングが必要です。続行しますか？",
            "COMPASS Presenter Bridge",
            System.Windows.Forms.MessageBoxButtons.YesNo,
            System.Windows.Forms.MessageBoxIcon.Warning,
            System.Windows.Forms.MessageBoxDefaultButton.Button2) ==
        System.Windows.Forms.DialogResult.Yes;
}
