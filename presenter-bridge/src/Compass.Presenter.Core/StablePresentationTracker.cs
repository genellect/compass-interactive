using Compass.Presenter.Contracts;

namespace Compass.Presenter.Core;

public sealed class StablePresentationTracker
{
    private readonly long minimumStableTicks;
    private BoundPresentation? binding;
    private PresentationObservation? candidate;
    private StablePageState? lastStable;

    public StablePresentationTracker(TimeSpan minimumStableDuration)
    {
        if (minimumStableDuration <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(minimumStableDuration));
        }

        minimumStableTicks = ToStopwatchTicks(minimumStableDuration);
    }

    public BoundPresentation? Binding => binding;

    public StablePageState? LastStable => lastStable;

    public BoundPresentation Bind(
        PresentationObservation observation,
        int expectedPdfPageCount)
    {
        var eligibility = PresentationEligibilityEvaluator.Evaluate(
            observation,
            expectedPdfPageCount);
        if (!eligibility.Eligible)
        {
            throw new InvalidOperationException(
                $"Presentation is not eligible: {string.Join(',', eligibility.Issues)}");
        }

        binding = new BoundPresentation(
            observation.DeckBindingDigest,
            observation.PresentationInstance,
            observation.OrderedSlideIds.ToArray(),
            observation.SlideCount);
        candidate = null;
        lastStable = null;
        return binding;
    }

    public StablePageState? Observe(PresentationObservation observation)
    {
        var currentBinding = binding ??
            throw new InvalidOperationException("Presentation is not bound.");
        EnsureBindingIsUnchanged(currentBinding, observation);

        if (candidate is null ||
            candidate.CurrentSlideId != observation.CurrentSlideId ||
            candidate.CurrentSlideIndex != observation.CurrentSlideIndex)
        {
            candidate = observation;
            return null;
        }

        var elapsed = observation.ObservedMonotonicTimestamp -
            candidate.ObservedMonotonicTimestamp;
        if (elapsed < minimumStableTicks)
        {
            return null;
        }

        if (lastStable is not null &&
            lastStable.SlideId == observation.CurrentSlideId &&
            lastStable.PageNumber == observation.CurrentSlideIndex)
        {
            return null;
        }

        lastStable = new StablePageState(
            observation.DeckBindingDigest,
            observation.CurrentSlideIndex,
            observation.CurrentSlideId,
            observation.ObservedMonotonicTimestamp);
        return lastStable;
    }

    private static void EnsureBindingIsUnchanged(
        BoundPresentation binding,
        PresentationObservation observation)
    {
        if (observation.DeckBindingDigest != binding.DeckBindingDigest ||
            observation.SlideCount != binding.SlideCount ||
            !observation.OrderedSlideIds.SequenceEqual(binding.OrderedSlideIds))
        {
            throw new PresentationBindingChangedException();
        }

        if (observation.CurrentSlideIndex is < 1 ||
            observation.CurrentSlideIndex > binding.OrderedSlideIds.Count ||
            binding.OrderedSlideIds[observation.CurrentSlideIndex - 1] !=
                observation.CurrentSlideId)
        {
            throw new PresentationBindingChangedException();
        }
    }

    private static long ToStopwatchTicks(TimeSpan duration) =>
        checked((long)(duration.TotalSeconds * System.Diagnostics.Stopwatch.Frequency));
}

public sealed class PresentationBindingChangedException : Exception
{
    public PresentationBindingChangedException()
        : base("The PowerPoint presentation changed after binding.")
    {
    }
}
