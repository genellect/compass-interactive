using System.Collections.Concurrent;
using Compass.Presenter.Contracts;
using Compass.Presenter.Loopback;

namespace Compass.Presenter.Tests;

internal sealed class FakePresentationSource : IPresentationObservationSource
{
    private readonly object gate = new();
    private PresentationObservation? observation;

    public FakePresentationSource(PresentationObservation? observation)
    {
        this.observation = observation;
    }

    public event EventHandler? ReconcileRequested;

    public ValueTask<PresentationObservation?> ObserveAsync(
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (gate)
        {
            return ValueTask.FromResult(observation);
        }
    }

    public void Set(PresentationObservation? next)
    {
        lock (gate)
        {
            observation = next;
        }
    }

    public void Signal() => ReconcileRequested?.Invoke(this, EventArgs.Empty);

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

internal sealed class HangingPresentationSource : IPresentationObservationSource
{
    public event EventHandler? ReconcileRequested;

    public async ValueTask<PresentationObservation?> ObserveAsync(
        CancellationToken cancellationToken)
    {
        await Task.Delay(Timeout.InfiniteTimeSpan, CancellationToken.None);
        return null;
    }

    public void Signal() => ReconcileRequested?.Invoke(this, EventArgs.Empty);

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

internal sealed class ImmediateSink : IPageUpdateSink
{
    public ValueTask SendAsync(
        PageUpdateEnvelope update,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.CompletedTask;
    }
}

internal sealed class FakePairingTicketVerifier : IPairingTicketVerifier
{
    private readonly string expectedTicket;
    private int consumed;

    public FakePairingTicketVerifier(string expectedTicket)
    {
        this.expectedTicket = expectedTicket;
    }

    public ValueTask<PairingTicketClaims?> VerifyAndConsumeAsync(
        string ticket,
        Guid lectureSessionId,
        string pdfDocumentId,
        string pdfDocumentVersion,
        int pdfPageCount,
        string origin,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (ticket != expectedTicket ||
            Interlocked.Exchange(ref consumed, 1) != 0)
        {
            return ValueTask.FromResult<PairingTicketClaims?>(null);
        }

        return ValueTask.FromResult<PairingTicketClaims?>(
            new PairingTicketClaims(
                lectureSessionId,
                pdfDocumentId,
                pdfDocumentVersion,
                pdfPageCount,
                DateTimeOffset.UtcNow.AddSeconds(60))
            {
                ConnectionId = Guid.Parse(
                    "72900000-0000-4000-8000-000000000099"),
            });
    }
}

internal sealed class FakeActivationHandler :
    IPresenterSessionActivationHandler,
    IPresenterSessionFaultSource
{
    public event EventHandler<PresenterSessionFaultedEventArgs>? SessionFaulted;

    public Guid ConnectionId { get; private set; }

    public ValueTask<PresenterSessionActivationResult> ActivateAsync(
        PresenterSessionActivation activation,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ConnectionId = activation.Claims.ConnectionId;
        return ValueTask.FromResult(
            new PresenterSessionActivationResult(
                activation.Claims.ExpiresAt));
    }

    public ValueTask DisconnectAsync(
        Guid connectionId,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.CompletedTask;
    }

    public void Fail()
    {
        SessionFaulted?.Invoke(
            this,
            new PresenterSessionFaultedEventArgs(
                ConnectionId,
                PresenterIssueCodes.PresenterSessionStopped));
    }
}

internal sealed class RecordingSink : IPageUpdateSink
{
    private readonly ConcurrentQueue<PageUpdateEnvelope> calls = new();
    private readonly TaskCompletionSource firstStarted = new(
        TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource releaseFirst = new(
        TaskCreationOptions.RunContinuationsAsynchronously);
    private int callCount;

    public IReadOnlyList<PageUpdateEnvelope> Calls => calls.ToArray();

    public Task FirstStarted => firstStarted.Task;

    public void ReleaseFirst() => releaseFirst.TrySetResult();

    public async ValueTask SendAsync(
        PageUpdateEnvelope update,
        CancellationToken cancellationToken)
    {
        var call = Interlocked.Increment(ref callCount);
        calls.Enqueue(update);
        if (call == 1)
        {
            firstStarted.TrySetResult();
            await releaseFirst.Task.WaitAsync(cancellationToken);
        }
    }
}

internal sealed class RetryRecordingSink : IPageUpdateSink
{
    private readonly List<PageUpdateEnvelope> calls = [];
    private readonly object gate = new();

    public IReadOnlyList<PageUpdateEnvelope> Calls
    {
        get
        {
            lock (gate)
            {
                return calls.ToArray();
            }
        }
    }

    public ValueTask SendAsync(
        PageUpdateEnvelope update,
        CancellationToken cancellationToken)
    {
        lock (gate)
        {
            calls.Add(update);
            if (calls.Count == 1)
            {
                throw new HttpRequestException("synthetic outage");
            }
        }

        return ValueTask.CompletedTask;
    }
}

internal static class TestData
{
    public static readonly int[] SlideIds =
        Enumerable.Range(1, 50).Select(index => 10_000 + index).ToArray();

    public static PresentationObservation Observation(
        int page,
        long timestamp,
        IReadOnlyList<int>? slideIds = null,
        string? digest = null,
        bool hidden = false,
        PresentationRangeMode rangeMode = PresentationRangeMode.AllSlides,
        PresentationWindowMode windowMode = PresentationWindowMode.Window,
        bool presenterView = false)
    {
        var ids = slideIds ?? SlideIds;
        return new PresentationObservation(
            "powerpoint-process",
            "presentation-instance",
            digest ?? new string('a', 64),
            new string('b', 64),
            new string('c', 64),
            "lecture.pptx",
            ids,
            ids[page - 1],
            page,
            ids.Count,
            hidden,
            hidden ? 1 : 0,
            rangeMode,
            windowMode,
            presenterView,
            timestamp);
    }

    public static long Milliseconds(int milliseconds) =>
        checked((long)(milliseconds / 1000d * System.Diagnostics.Stopwatch.Frequency));
}
