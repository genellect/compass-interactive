using Compass.Presenter.Contracts;
using Compass.Presenter.Core;

namespace Compass.Presenter.Loopback;

internal sealed record PresenterReadiness(bool Ready, string? Issue);

internal sealed class PresenterReadinessProbe(
    IPresentationObservationSource source,
    TimeProvider? timeProvider = null,
    TimeSpan? observationTimeout = null)
{
    private readonly object gate = new();
    private readonly TimeProvider time = timeProvider ?? TimeProvider.System;
    private readonly TimeSpan timeout = observationTimeout ?? TimeSpan.FromSeconds(1);
    private Task<PresenterReadiness>? pending;
    private DateTimeOffset observedAt = DateTimeOffset.MinValue;

    public Task<PresenterReadiness> GetAsync(CancellationToken cancellationToken)
    {
        lock (gate)
        {
            if (pending is null || pending.IsCompleted &&
                time.GetUtcNow() - observedAt >= TimeSpan.FromSeconds(2))
            {
                observedAt = time.GetUtcNow();
                pending = ProbeAsync();
            }
            return pending.WaitAsync(cancellationToken);
        }
    }

    private async Task<PresenterReadiness> ProbeAsync()
    {
        using var cancellation = new CancellationTokenSource(timeout);
        try
        {
            var observation = await source.ObserveAsync(cancellation.Token).AsTask()
                .WaitAsync(cancellation.Token).ConfigureAwait(false);
            if (observation is null)
                return new(false, PresenterIssueCodes.PowerPointNotRunning);
            // This preflight is independent of any lecture/PDF or pairing ticket.
            var eligibility = PresentationEligibilityEvaluator.Evaluate(
                observation, observation.SlideCount);
            return new(eligibility.Eligible, eligibility.Issues.FirstOrDefault());
        }
        catch
        {
            return new(false, "observation_unavailable");
        }
    }
}
