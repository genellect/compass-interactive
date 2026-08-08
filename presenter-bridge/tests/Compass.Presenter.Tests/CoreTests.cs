using Compass.Presenter.Contracts;
using Compass.Presenter.Core;

namespace Compass.Presenter.Tests;

internal static class CoreTests
{
    public static Task EligibilityRejectsUnsupportedDecks()
    {
        var observation = TestData.Observation(
            1,
            0,
            hidden: true,
            rangeMode: PresentationRangeMode.CustomShow,
            windowMode: PresentationWindowMode.Speaker,
            presenterView: true);
        var result = PresentationEligibilityEvaluator.Evaluate(observation, 49);
        Assert.False(result.Eligible);
        Assert.Contains("page_count_mismatch", result.Issues);
        Assert.Contains("hidden_slides_unsupported", result.Issues);
        Assert.Contains("custom_or_partial_show_unsupported", result.Issues);
        Assert.Contains("windowed_slide_show_required", result.Issues);
        Assert.Contains("presenter_view_must_be_disabled", result.Issues);
        return Task.CompletedTask;
    }

    public static Task PreTransitionEventNeverCommitsOldSlide()
    {
        var tracker = BoundTracker();
        Assert.Null(tracker.Observe(TestData.Observation(1, TestData.Milliseconds(50))));
        Assert.Null(tracker.Observe(TestData.Observation(2, TestData.Milliseconds(150))));
        var stable = tracker.Observe(
            TestData.Observation(2, TestData.Milliseconds(300)));
        Assert.Equal(2, stable?.PageNumber);
        return Task.CompletedTask;
    }

    public static Task BindingMutationStopsSynchronization()
    {
        var tracker = BoundTracker();
        var reordered = TestData.SlideIds.ToArray();
        (reordered[0], reordered[1]) = (reordered[1], reordered[0]);
        Assert.Throws<PresentationBindingChangedException>(() =>
            tracker.Observe(TestData.Observation(1, TestData.Milliseconds(200), reordered)));
        Assert.Throws<PresentationBindingChangedException>(() =>
            tracker.Observe(TestData.Observation(
                1,
                TestData.Milliseconds(200),
                digest: new string('b', 64))));
        return Task.CompletedTask;
    }

    public static Task FixedSeedTenThousandTraceConverges()
    {
        const int seed = 729_10000;
        var random = new Random(seed);
        var tracker = BoundTracker();
        var currentPage = 1;
        var now = 0;
        for (var index = 0; index < 10_000; index++)
        {
            var nextPage = random.Next(1, 51);
            if (nextPage == currentPage)
            {
                nextPage = nextPage == 50 ? 1 : nextPage + 1;
            }

            now += random.Next(1, 80);
            Assert.Null(tracker.Observe(TestData.Observation(currentPage, TestData.Milliseconds(now))));
            now += random.Next(20, 100);
            Assert.Null(tracker.Observe(TestData.Observation(nextPage, TestData.Milliseconds(now))));
            now += 120;
            var stable = tracker.Observe(
                TestData.Observation(nextPage, TestData.Milliseconds(now)));
            Assert.Equal(nextPage, stable?.PageNumber);
            currentPage = nextPage;
        }

        return Task.CompletedTask;
    }

    public static Task FiveHundredTransitionEquivalentHasNoWrongPage()
    {
        var tracker = BoundTracker();
        var currentPage = 1;
        var now = 0;
        var committed = new List<int>();
        for (var transition = 0; transition < 500; transition++)
        {
            var nextPage = ((transition * 17 + 7) % 50) + 1;
            if (nextPage == currentPage)
            {
                nextPage = nextPage == 50 ? 1 : nextPage + 1;
            }

            now += 50;
            Assert.Null(tracker.Observe(TestData.Observation(currentPage, TestData.Milliseconds(now))));
            now += 100;
            Assert.Null(tracker.Observe(TestData.Observation(nextPage, TestData.Milliseconds(now))));
            now += 150;
            var stable = tracker.Observe(
                TestData.Observation(nextPage, TestData.Milliseconds(now)));
            Assert.Equal(nextPage, stable?.PageNumber);
            committed.Add(stable!.PageNumber);
            currentPage = nextPage;
        }

        for (var build = 0; build < 200; build++)
        {
            now += 200;
            Assert.Null(tracker.Observe(TestData.Observation(currentPage, TestData.Milliseconds(now))));
        }

        Assert.Equal(500, committed.Count);
        return Task.CompletedTask;
    }

    public static async Task LatestOnlyDispatcherDropsIntermediatePage()
    {
        var sink = new RecordingSink();
        await using var dispatcher = new LatestOnlyPageDispatcher(
            sink,
            TimeSpan.FromMilliseconds(1),
            TimeSpan.FromMilliseconds(1));
        dispatcher.Submit(Page(2));
        await sink.FirstStarted.WaitAsync(TimeSpan.FromSeconds(2));
        dispatcher.Submit(Page(3));
        dispatcher.Submit(Page(4));
        sink.ReleaseFirst();
        await Assert.EventuallyAsync(
            () => sink.Calls.Count == 2,
            TimeSpan.FromSeconds(2));
        Assert.SequenceEqual(new[] { 2, 4 },
            sink.Calls.Select(call => call.State.PageNumber));
    }

    public static async Task RetryReusesEventIdentity()
    {
        var sink = new RetryRecordingSink();
        await using var dispatcher = new LatestOnlyPageDispatcher(
            sink,
            TimeSpan.FromMilliseconds(1),
            TimeSpan.FromMilliseconds(1));
        dispatcher.Submit(Page(8));
        await Assert.EventuallyAsync(
            () => sink.Calls.Count >= 2,
            TimeSpan.FromSeconds(2));
        var calls = sink.Calls;
        Assert.Equal(calls[0].EventId, calls[1].EventId);
        Assert.Equal(calls[0].Sequence, calls[1].Sequence);
    }

    public static async Task MissingSlideShowFaultsWithinGrace()
    {
        var source = new FakePresentationSource(TestData.Observation(1, 0));
        var tracker = BoundTracker();
        var dispatcher = new LatestOnlyPageDispatcher(
            new ImmediateSink(),
            TimeSpan.FromMilliseconds(1),
            TimeSpan.FromMilliseconds(1));
        await using var runtime = new PresenterReconciliationRuntime(
            source,
            tracker,
            dispatcher,
            pollInterval: TimeSpan.FromMilliseconds(5),
            eventDelay: TimeSpan.FromMilliseconds(1),
            observationTimeout: TimeSpan.FromMilliseconds(50),
            missingObservationGrace: TimeSpan.FromMilliseconds(20),
            disposeSource: false);
        var fault = new TaskCompletionSource<Exception>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        runtime.Faulted += (_, error) => fault.TrySetResult(error);
        runtime.Start();
        source.Set(null);
        source.Signal();

        var error = await fault.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.True(error is InvalidOperationException);
    }

    public static async Task HungObservationFaultsWithinTimeout()
    {
        var source = new HangingPresentationSource();
        var tracker = BoundTracker();
        var dispatcher = new LatestOnlyPageDispatcher(
            new ImmediateSink(),
            TimeSpan.FromMilliseconds(1),
            TimeSpan.FromMilliseconds(1));
        await using var runtime = new PresenterReconciliationRuntime(
            source,
            tracker,
            dispatcher,
            pollInterval: TimeSpan.FromMilliseconds(5),
            eventDelay: TimeSpan.FromMilliseconds(1),
            observationTimeout: TimeSpan.FromMilliseconds(20),
            missingObservationGrace: TimeSpan.FromMilliseconds(50),
            disposeSource: false);
        var fault = new TaskCompletionSource<Exception>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        runtime.Faulted += (_, error) => fault.TrySetResult(error);
        runtime.Start();

        var error = await fault.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.True(error is TimeoutException);
    }

    private static StablePresentationTracker BoundTracker()
    {
        var tracker = new StablePresentationTracker(TimeSpan.FromMilliseconds(100));
        _ = tracker.Bind(TestData.Observation(1, 0), TestData.SlideIds.Length);
        return tracker;
    }

    private static StablePageState Page(int page) => new(
        new string('a', 64),
        page,
        TestData.SlideIds[page - 1],
        TestData.Milliseconds(page * 200));
}
