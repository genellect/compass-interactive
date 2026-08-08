using System.Diagnostics;
using System.Threading.Channels;
using Compass.Presenter.Contracts;

namespace Compass.Presenter.Core;

public sealed class PresenterReconciliationRuntime : IAsyncDisposable
{
    private readonly IPresentationObservationSource source;
    private readonly StablePresentationTracker tracker;
    private readonly LatestOnlyPageDispatcher dispatcher;
    private readonly TimeSpan pollInterval;
    private readonly TimeSpan eventDelay;
    private readonly TimeSpan observationTimeout;
    private readonly TimeSpan missingObservationGrace;
    private readonly bool disposeSource;
    private readonly Channel<bool> signals = Channel.CreateBounded<bool>(
        new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false,
        });
    private readonly CancellationTokenSource lifetime = new();
    private Task? poller;
    private Task? worker;

    public PresenterReconciliationRuntime(
        IPresentationObservationSource source,
        StablePresentationTracker tracker,
        LatestOnlyPageDispatcher dispatcher,
        TimeSpan? pollInterval = null,
        TimeSpan? eventDelay = null,
        TimeSpan? observationTimeout = null,
        TimeSpan? missingObservationGrace = null,
        bool disposeSource = true)
    {
        this.source = source;
        this.tracker = tracker;
        this.dispatcher = dispatcher;
        this.pollInterval = pollInterval ?? TimeSpan.FromMilliseconds(200);
        this.eventDelay = eventDelay ?? TimeSpan.FromMilliseconds(150);
        this.observationTimeout = observationTimeout ?? TimeSpan.FromSeconds(2);
        this.missingObservationGrace = missingObservationGrace ??
            TimeSpan.FromSeconds(3);
        this.disposeSource = disposeSource;
    }

    public event EventHandler<Exception>? Faulted;

    public async Task<BoundPresentation> BindAsync(
        int expectedPdfPageCount,
        CancellationToken cancellationToken)
    {
        var observation = await ObserveWithTimeoutAsync(cancellationToken)
            .ConfigureAwait(false) ??
            throw new InvalidOperationException("No active PowerPoint slide show was found.");
        return tracker.Bind(observation, expectedPdfPageCount);
    }

    public void Start()
    {
        if (poller is not null || worker is not null)
        {
            throw new InvalidOperationException("Presenter runtime is already running.");
        }

        source.ReconcileRequested += OnReconcileRequested;
        poller = Task.Run(PollAsync);
        worker = Task.Run(WorkAsync);
        signals.Writer.TryWrite(true);
    }

    public async ValueTask DisposeAsync()
    {
        source.ReconcileRequested -= OnReconcileRequested;
        lifetime.Cancel();
        signals.Writer.TryComplete();
        var tasks = new[] { poller, worker }.Where(task => task is not null)!;
        try
        {
            await Task.WhenAll(tasks!).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }

        await dispatcher.DisposeAsync().ConfigureAwait(false);
        if (disposeSource)
        {
            await source.DisposeAsync().ConfigureAwait(false);
        }
        lifetime.Dispose();
    }

    private async Task PollAsync()
    {
        using var timer = new PeriodicTimer(pollInterval);
        while (await timer.WaitForNextTickAsync(lifetime.Token).ConfigureAwait(false))
        {
            signals.Writer.TryWrite(true);
        }
    }

    private async Task WorkAsync()
    {
        long? missingObservationStartedAt = null;
        await foreach (var _ in signals.Reader.ReadAllAsync(lifetime.Token)
            .ConfigureAwait(false))
        {
            try
            {
                var observation = await ObserveWithTimeoutAsync(lifetime.Token)
                    .ConfigureAwait(false);
                if (observation is null)
                {
                    missingObservationStartedAt ??= Stopwatch.GetTimestamp();
                    if (Stopwatch.GetElapsedTime(
                            missingObservationStartedAt.Value) >=
                        missingObservationGrace)
                    {
                        throw new InvalidOperationException(
                            "The active PowerPoint slide show was lost.");
                    }
                    continue;
                }

                missingObservationStartedAt = null;
                var stable = tracker.Observe(observation);
                if (stable is not null)
                {
                    dispatcher.Submit(stable);
                }
            }
            catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
            {
                return;
            }
            catch (Exception error)
            {
                try
                {
                    Faulted?.Invoke(this, error);
                }
                finally
                {
                    lifetime.Cancel();
                }
                return;
            }
        }
    }

    private async ValueTask<PresentationObservation?> ObserveWithTimeoutAsync(
        CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken);
        timeout.CancelAfter(observationTimeout);
        try
        {
            return await source.ObserveAsync(timeout.Token)
                .AsTask()
                .WaitAsync(timeout.Token)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (
            !cancellationToken.IsCancellationRequested)
        {
            throw new TimeoutException(
                "PowerPoint observation did not complete within the allowed time.");
        }
    }

    private void OnReconcileRequested(object? sender, EventArgs args)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(eventDelay, lifetime.Token).ConfigureAwait(false);
                signals.Writer.TryWrite(true);
            }
            catch (OperationCanceledException)
            {
            }
        });
    }
}
