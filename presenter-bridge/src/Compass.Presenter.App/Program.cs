using System.Runtime.Versioning;
using Compass.Presenter.Loopback;
using Compass.Presenter.PowerPoint.External;
#if !PRESENTER_STORE
using Velopack;
#endif

namespace Compass.Presenter.App;

internal static class Program
{
    [STAThread]
    [SupportedOSPlatform("windows10.0.19041")]
    private static async Task<int> Main(string[] args)
    {
#if !PRESENTER_STORE
        VelopackApp.Build()
            .SetArgs(args)
            .SetAutoApplyOnStartup(false)
            .Run();
#endif

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
        var removeInstallationIdentity = 0;

        using var activityGate = new SemaphoreSlim(1, 1);
#if !PRESENTER_STORE
        using var updateLifetime = new CancellationTokenSource();
#endif
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
            async Task<bool> RequestInstallationIdentityRemovalAsync(
                CancellationToken cancellationToken)
            {
                if (!await activityGate.WaitAsync(0, cancellationToken)
                    .ConfigureAwait(false))
                {
                    return false;
                }
                try
                {
                    if (server.HasLiveSession)
                    {
                        return false;
                    }
                    return await coordinator.TryRunWhenIdleAsync(
                        _ =>
                        {
                            Interlocked.Exchange(
                                ref removeInstallationIdentity,
                                1);
                            shutdown.TrySetResult();
                            return Task.CompletedTask;
                        },
                        cancellationToken).ConfigureAwait(false);
                }
                finally
                {
                    activityGate.Release();
                }
            }
#if !PRESENTER_STORE
            using var updateProvider = VelopackPresenterUpdater.TryCreate();
            var updates = updateProvider is null ? null : new PresenterUpdateCoordinator(
                activityGate,
                () => server.HasLiveSession,
                coordinator.TryRunWhenIdleAsync,
                updateProvider);
#endif
            await using var tray = await PresenterTrayHost.StartAsync(
                manualRecovery.RecoverAsync,
#if PRESENTER_STORE
                () => shutdown.TrySetResult(),
                RequestInstallationIdentityRemovalAsync).ConfigureAwait(false);
#else
                () => shutdown.TrySetResult(),
                RequestInstallationIdentityRemovalAsync,
                updates is null ? null : updates.CheckAsync,
                updates is null ? null : updates.InstallAsync).ConfigureAwait(false);
#endif
            EventHandler<PresenterSessionStateChangedEventArgs> stateChanged =
                (_, eventArgs) => tray.ReportSessionState(eventArgs.State);
            coordinator.SessionStateChanged += stateChanged;
#if !PRESENTER_STORE
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
#endif
            try
            {
                tray.ReportSessionState(coordinator.SessionState);
                await shutdown.Task.ConfigureAwait(false);
            }
            finally
            {
#if !PRESENTER_STORE
                updateLifetime.Cancel();
                await updateCheck.ConfigureAwait(false);
#endif
                coordinator.SessionStateChanged -= stateChanged;
#if !PRESENTER_STORE
                if (updates is not null)
                {
                    updates.AvailabilityChanged -= tray.ReportUpdateAvailability;
                }
#endif
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
            if (Volatile.Read(ref removeInstallationIdentity) != 0)
            {
                try
                {
                    await coordinator.DisposeAsync().ConfigureAwait(false);
                    installationProof.DeletePersistedIdentity();
                }
                catch
                {
                    ShowInstallationIdentityRemovalError();
                }
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

    private static void ShowInstallationIdentityRemovalError() =>
        System.Windows.Forms.MessageBox.Show(
            "ローカル接続IDを削除できませんでした。アプリを再起動して、もう一度お試しください。",
            "COMPASS Presenter Bridge",
            System.Windows.Forms.MessageBoxButtons.OK,
            System.Windows.Forms.MessageBoxIcon.Error);
}
