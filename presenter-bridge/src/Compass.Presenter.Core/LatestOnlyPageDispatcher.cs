using Compass.Presenter.Contracts;

namespace Compass.Presenter.Core;

public sealed class LatestOnlyPageDispatcher : IAsyncDisposable
{
    private readonly object gate = new();
    private readonly IPageUpdateSink sink;
    private readonly TimeSpan minimumSendInterval;
    private readonly TimeSpan retryDelay;
    private readonly CancellationTokenSource lifetime = new();
    private readonly SemaphoreSlim changed = new(0, 1);
    private readonly Task worker;
    private readonly Guid connectorEpoch = Guid.NewGuid();
    private StablePageState? desired;
    private StablePageState? acknowledged;
    private long sequence;

    public LatestOnlyPageDispatcher(
        IPageUpdateSink sink,
        TimeSpan? minimumSendInterval = null,
        TimeSpan? retryDelay = null)
    {
        this.sink = sink;
        this.minimumSendInterval = minimumSendInterval ?? TimeSpan.FromMilliseconds(200);
        this.retryDelay = retryDelay ?? TimeSpan.FromMilliseconds(250);
        worker = Task.Run(RunAsync);
    }

    public StablePageState? Acknowledged
    {
        get
        {
            lock (gate)
            {
                return acknowledged;
            }
        }
    }

    public void Submit(StablePageState state)
    {
        var shouldSignal = false;
        lock (gate)
        {
            if (SamePage(desired, state) || SamePage(acknowledged, state))
            {
                return;
            }

            desired = state;
            shouldSignal = true;
        }

        if (shouldSignal)
        {
            TrySignal();
        }
    }

    public async ValueTask DisposeAsync()
    {
        lifetime.Cancel();
        TrySignal();
        try
        {
            await worker.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }

        changed.Dispose();
        lifetime.Dispose();
    }

    private async Task RunAsync()
    {
        var lastSentAt = DateTimeOffset.MinValue;
        while (!lifetime.IsCancellationRequested)
        {
            await changed.WaitAsync(lifetime.Token).ConfigureAwait(false);
            while (!lifetime.IsCancellationRequested)
            {
                StablePageState? snapshot;
                lock (gate)
                {
                    snapshot = desired;
                    if (snapshot is null || SamePage(snapshot, acknowledged))
                    {
                        desired = null;
                        break;
                    }
                }

                var wait = minimumSendInterval -
                    (DateTimeOffset.UtcNow - lastSentAt);
                if (wait > TimeSpan.Zero)
                {
                    await Task.Delay(wait, lifetime.Token).ConfigureAwait(false);
                }

                var envelope = new PageUpdateEnvelope(
                    connectorEpoch,
                    Guid.NewGuid(),
                    Interlocked.Increment(ref sequence),
                    snapshot);
                while (!lifetime.IsCancellationRequested)
                {
                    try
                    {
                        await sink.SendAsync(envelope, lifetime.Token)
                            .ConfigureAwait(false);
                        lastSentAt = DateTimeOffset.UtcNow;
                        lock (gate)
                        {
                            acknowledged = snapshot;
                            if (SamePage(desired, snapshot))
                            {
                                desired = null;
                            }
                        }

                        break;
                    }
                    catch (OperationCanceledException) when (
                        lifetime.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch
                    {
                        StablePageState? newest;
                        lock (gate)
                        {
                            newest = desired;
                        }

                        if (newest is not null && !SamePage(newest, snapshot))
                        {
                            break;
                        }

                        await Task.Delay(retryDelay, lifetime.Token)
                            .ConfigureAwait(false);
                    }
                }
            }
        }
    }

    private void TrySignal()
    {
        try
        {
            changed.Release();
        }
        catch (SemaphoreFullException)
        {
        }
        catch (ObjectDisposedException)
        {
        }
    }

    private static bool SamePage(
        StablePageState? left,
        StablePageState? right) =>
        left is not null &&
        right is not null &&
        left.DeckBindingDigest == right.DeckBindingDigest &&
        left.PageNumber == right.PageNumber &&
        left.SlideId == right.SlideId;
}
