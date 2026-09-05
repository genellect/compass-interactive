using Compass.Presenter.Contracts;
using Compass.Presenter.Loopback;

namespace Compass.Presenter.Tests;

internal static class ReadinessTests
{
    public static async Task HealthReadinessCachesRefreshesAndBoundsHungCom()
    {
        var time = new ReadinessTime();
        var source = new CountingSource();
        var readiness = new PresenterReadinessProbe(source, time, TimeSpan.FromMilliseconds(25));
        var absent = await readiness.GetAsync(CancellationToken.None);
        Assert.False(absent.Ready);
        Assert.Equal(PresenterIssueCodes.PowerPointNotRunning, absent.Issue);
        source.Observation = TestData.Observation(1, 0);
        Assert.False((await readiness.GetAsync(CancellationToken.None)).Ready);
        Assert.Equal(1, source.Observations);
        time.Advance();
        var ready = await readiness.GetAsync(CancellationToken.None);
        Assert.True(ready.Ready);
        Assert.True(ready.Issue is null);
        source.Observation = source.Observation with { PresenterViewEnabled = true };
        time.Advance();
        Assert.Equal("presenter_view_must_be_disabled",
            (await readiness.GetAsync(CancellationToken.None)).Issue);
        var hung = new PresenterReadinessProbe(new HangingPresentationSource(), time,
            TimeSpan.FromMilliseconds(25));
        var result = await hung.GetAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(1));
        Assert.False(result.Ready);
        Assert.Equal("observation_unavailable", result.Issue);
    }

    private sealed class ReadinessTime : TimeProvider
    {
        private DateTimeOffset current = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => current;
        public void Advance() => current = current.AddSeconds(3);
    }

    private sealed class CountingSource : IPresentationObservationSource
    {
        public event EventHandler? ReconcileRequested { add { } remove { } }
        public int Observations { get; private set; }
        public PresentationObservation? Observation { get; set; }
        public ValueTask<PresentationObservation?> ObserveAsync(CancellationToken cancellationToken)
        {
            Observations++;
            return ValueTask.FromResult(Observation);
        }
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
