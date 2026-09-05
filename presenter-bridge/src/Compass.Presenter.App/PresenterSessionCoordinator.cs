using Compass.Presenter.Contracts;
using Compass.Presenter.Core;
using Compass.Presenter.Loopback;

namespace Compass.Presenter.App;

internal enum PresenterSessionState
{
    Idle,
    Active,
    Faulted,
}

internal sealed class PresenterSessionStateChangedEventArgs : EventArgs
{
    public PresenterSessionStateChangedEventArgs(PresenterSessionState state) =>
        State = state;

    public PresenterSessionState State { get; }
}

internal sealed class PresenterSessionCoordinator :
    IPresenterSessionActivationHandler,
    IPresenterSessionFaultSource,
    IAsyncDisposable
{
    private readonly EdgePresenterClient client;
    private readonly IPresentationObservationSource presentationSource;
    private readonly string installationHash;
    private readonly SemaphoreSlim gate = new(1, 1);
    private ActiveSession? activeSession;
    private bool disposed;
    private int sessionState;

    public event EventHandler<PresenterSessionFaultedEventArgs>? SessionFaulted;
    public event EventHandler<PresenterSessionStateChangedEventArgs>?
        SessionStateChanged;

    public PresenterSessionState SessionState =>
        (PresenterSessionState)Volatile.Read(ref sessionState);

    public PresenterSessionCoordinator(
        EdgePresenterClient client,
        IPresentationObservationSource presentationSource,
        string installationHash)
    {
        this.client = client;
        this.presentationSource = presentationSource;
        this.installationHash = installationHash;
    }

    public async ValueTask<PresenterSessionActivationResult> ActivateAsync(
        PresenterSessionActivation activation,
        CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (activeSession is not null)
            {
                if (activeSession.Capability.ConnectionId ==
                    activation.Claims.ConnectionId)
                {
                    return new PresenterSessionActivationResult(
                        activeSession.Capability.ExpiresAt);
                }
                throw new PresenterRemoteException("connector_conflict");
            }

            var observation = await presentationSource.ObserveAsync(
                cancellationToken).ConfigureAwait(false) ??
                throw new PresenterRemoteException("powerpoint_not_running");
            if (!string.Equals(
                    observation.DeckBindingDigest,
                    activation.Presentation.BindingDigest,
                    StringComparison.Ordinal))
            {
                throw new PresenterRemoteException("presentation_changed");
            }

            var tracker = new StablePresentationTracker(
                TimeSpan.FromMilliseconds(100));
            tracker.Bind(observation, activation.Claims.PdfPageCount);

            PresenterCapability? capability = null;
            PresenterReconciliationRuntime? runtime = null;
            try
            {
                capability = await client.ClaimAsync(
                    activation.Claims,
                    installationHash,
                    cancellationToken).ConfigureAwait(false);
                var sink = new RemotePageUpdateSink(
                    client,
                    capability,
                    installationHash,
                    observation.PptxFileSha256,
                    observation.SlideIdOrderSha256);
                var dispatcher = new LatestOnlyPageDispatcher(
                    sink,
                    TimeSpan.FromMilliseconds(200),
                    TimeSpan.FromMilliseconds(250));
                runtime = new PresenterReconciliationRuntime(
                    presentationSource,
                    tracker,
                    dispatcher,
                    pollInterval: TimeSpan.FromMilliseconds(200),
                    eventDelay: TimeSpan.FromMilliseconds(150),
                    disposeSource: false);
                var session = new ActiveSession(
                    capability,
                    observation.PptxFileSha256,
                    observation.SlideIdOrderSha256,
                    runtime);
                sink.TerminalRejected += (_, _) =>
                    QueueFaultStop(capability.ConnectionId);
                runtime.Faulted += (_, _) =>
                    QueueFaultStop(capability.ConnectionId);
                activeSession = session;
                runtime.Start();
                session.HeartbeatTask = Task.Run(
                    () => RunHeartbeatAsync(session),
                    CancellationToken.None);
                PublishSessionState(PresenterSessionState.Active);
                return new PresenterSessionActivationResult(
                    capability.ExpiresAt);
            }
            catch
            {
                activeSession = null;
                if (runtime is not null)
                {
                    await runtime.DisposeAsync().ConfigureAwait(false);
                }
                if (capability is not null)
                {
                    await BestEffortRemoteDisconnectAsync(capability)
                        .ConfigureAwait(false);
                }
                throw;
            }
        }
        finally
        {
            gate.Release();
        }
    }

    public async ValueTask DisconnectAsync(
        Guid connectionId,
        CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (activeSession is null ||
                activeSession.Capability.ConnectionId != connectionId)
            {
                return;
            }
            await StopActiveSessionAsync(
                disconnectRemote: true,
                cancellationToken,
                PresenterSessionState.Idle).ConfigureAwait(false);
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<bool> TryRunWhenIdleAsync(
        Func<CancellationToken, Task> action,
        CancellationToken cancellationToken)
    {
        if (disposed || !await gate.WaitAsync(0, cancellationToken)
            .ConfigureAwait(false))
        {
            return false;
        }
        try
        {
            if (activeSession is not null)
            {
                return false;
            }
            await action(cancellationToken).ConfigureAwait(false);
            return true;
        }
        finally
        {
            gate.Release();
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (disposed)
        {
            return;
        }
        disposed = true;
        await gate.WaitAsync().ConfigureAwait(false);
        try
        {
            await StopActiveSessionAsync(
                disconnectRemote: true,
                CancellationToken.None,
                PresenterSessionState.Idle).ConfigureAwait(false);
        }
        finally
        {
            gate.Release();
            gate.Dispose();
        }
    }

    private async Task RunHeartbeatAsync(ActiveSession session)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        var transientFailures = 0;
        try
        {
            while (await timer.WaitForNextTickAsync(session.Lifetime.Token)
                .ConfigureAwait(false))
            {
                if (session.Capability.ExpiresAt <= DateTimeOffset.UtcNow)
                {
                    QueueFaultStop(session.Capability.ConnectionId);
                    return;
                }
                try
                {
                    var heartbeat = await client.HeartbeatAsync(
                        session.Capability,
                        installationHash,
                        session.PptxFileSha256,
                        session.SlideIdOrderSha256,
                        session.Lifetime.Token).ConfigureAwait(false);
                    transientFailures = 0;
                    if (!heartbeat.Active)
                    {
                        QueueFaultStop(session.Capability.ConnectionId);
                        return;
                    }
                }
                catch (PresenterRemoteException error) when (error.Transient)
                {
                    transientFailures++;
                    if (transientFailures >= 3)
                    {
                        QueueFaultStop(session.Capability.ConnectionId);
                        return;
                    }
                }
                catch (OperationCanceledException) when (
                    session.Lifetime.IsCancellationRequested)
                {
                    return;
                }
                catch
                {
                    QueueFaultStop(session.Capability.ConnectionId);
                    return;
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    private void QueueFaultStop(Guid connectionId)
    {
        try
        {
            PublishSessionState(PresenterSessionState.Faulted);
            SessionFaulted?.Invoke(
                this,
                new PresenterSessionFaultedEventArgs(
                    connectionId,
                    PresenterIssueCodes.PresenterSessionStopped));
        }
        catch
        {
            // A local status observer must never prevent fail-closed shutdown.
        }

        _ = Task.Run(async () =>
        {
            try
            {
                await FaultStopAsync(connectionId).ConfigureAwait(false);
            }
            catch
            {
            }
        });
    }

    private async ValueTask StopActiveSessionAsync(
        bool disconnectRemote,
        CancellationToken cancellationToken,
        PresenterSessionState finalState)
    {
        var session = activeSession;
        activeSession = null;
        if (session is null)
        {
            return;
        }

        session.Lifetime.Cancel();
        await session.Runtime.DisposeAsync().ConfigureAwait(false);
        if (session.HeartbeatTask is not null &&
            session.HeartbeatTask.Id != Task.CurrentId)
        {
            try
            {
                await session.HeartbeatTask.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
            }
        }
        session.Lifetime.Dispose();

        if (disconnectRemote)
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
                cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(3));
            try
            {
                await client.DisconnectAsync(
                    session.Capability,
                    timeout.Token).ConfigureAwait(false);
            }
            catch
            {
                // Hosted expiry and the Admin handover fence remain authoritative.
            }
        }
        PublishSessionState(finalState);
    }

    private async Task FaultStopAsync(Guid connectionId)
    {
        await gate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (activeSession is null ||
                activeSession.Capability.ConnectionId != connectionId)
            {
                return;
            }
            await StopActiveSessionAsync(
                disconnectRemote: true,
                CancellationToken.None,
                PresenterSessionState.Faulted).ConfigureAwait(false);
        }
        finally
        {
            gate.Release();
        }
    }

    private void PublishSessionState(PresenterSessionState state)
    {
        var previous = (PresenterSessionState)Interlocked.Exchange(
            ref sessionState,
            (int)state);
        if (previous == state)
        {
            return;
        }
        try
        {
            SessionStateChanged?.Invoke(
                this,
                new PresenterSessionStateChangedEventArgs(state));
        }
        catch
        {
            // Local UI state must never alter the synchronization fence.
        }
    }

    private async ValueTask BestEffortRemoteDisconnectAsync(
        PresenterCapability capability)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        try
        {
            await client.DisconnectAsync(capability, timeout.Token)
                .ConfigureAwait(false);
        }
        catch
        {
        }
    }

    private sealed class ActiveSession
    {
        public ActiveSession(
            PresenterCapability capability,
            string pptxFileSha256,
            string slideIdOrderSha256,
            PresenterReconciliationRuntime runtime)
        {
            Capability = capability;
            PptxFileSha256 = pptxFileSha256;
            SlideIdOrderSha256 = slideIdOrderSha256;
            Runtime = runtime;
        }

        public PresenterCapability Capability { get; }
        public string PptxFileSha256 { get; }
        public string SlideIdOrderSha256 { get; }
        public PresenterReconciliationRuntime Runtime { get; }
        public CancellationTokenSource Lifetime { get; } = new();
        public Task? HeartbeatTask { get; set; }
    }
}

internal sealed class RemotePageUpdateSink : IPageUpdateSink
{
    private readonly EdgePresenterClient client;
    private readonly PresenterCapability capability;
    private readonly string installationHash;
    private readonly string pptxFileSha256;
    private readonly string slideIdOrderSha256;

    public RemotePageUpdateSink(
        EdgePresenterClient client,
        PresenterCapability capability,
        string installationHash,
        string pptxFileSha256,
        string slideIdOrderSha256)
    {
        this.client = client;
        this.capability = capability;
        this.installationHash = installationHash;
        this.pptxFileSha256 = pptxFileSha256;
        this.slideIdOrderSha256 = slideIdOrderSha256;
    }

    public event EventHandler? TerminalRejected;

    public async ValueTask SendAsync(
        PageUpdateEnvelope update,
        CancellationToken cancellationToken)
    {
        try
        {
            _ = await client.UpdatePageAsync(
                capability,
                installationHash,
                pptxFileSha256,
                slideIdOrderSha256,
                update,
                cancellationToken).ConfigureAwait(false);
        }
        catch (PresenterRemoteException error) when (!error.Transient)
        {
            TerminalRejected?.Invoke(this, EventArgs.Empty);
            throw;
        }
        catch (PresenterRemoteException error)
            when (error.Transient && error.RetryAfter is { } retryAfter)
        {
            await Task.Delay(retryAfter, cancellationToken).ConfigureAwait(false);
            throw;
        }
    }
}
