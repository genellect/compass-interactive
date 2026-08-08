namespace Compass.Presenter.Tests;

internal static class Program
{
    public static async Task<int> Main()
    {
        var tests = new (string Name, Func<Task> Run)[]
        {
            (nameof(CoreTests.EligibilityRejectsUnsupportedDecks), CoreTests.EligibilityRejectsUnsupportedDecks),
            (nameof(CoreTests.PreTransitionEventNeverCommitsOldSlide), CoreTests.PreTransitionEventNeverCommitsOldSlide),
            (nameof(CoreTests.BindingMutationStopsSynchronization), CoreTests.BindingMutationStopsSynchronization),
            (nameof(CoreTests.FixedSeedTenThousandTraceConverges), CoreTests.FixedSeedTenThousandTraceConverges),
            (nameof(CoreTests.FiveHundredTransitionEquivalentHasNoWrongPage), CoreTests.FiveHundredTransitionEquivalentHasNoWrongPage),
            (nameof(CoreTests.LatestOnlyDispatcherDropsIntermediatePage), CoreTests.LatestOnlyDispatcherDropsIntermediatePage),
            (nameof(CoreTests.RetryReusesEventIdentity), CoreTests.RetryReusesEventIdentity),
            (nameof(CoreTests.MissingSlideShowFaultsWithinGrace), CoreTests.MissingSlideShowFaultsWithinGrace),
            (nameof(CoreTests.HungObservationFaultsWithinTimeout), CoreTests.HungObservationFaultsWithinTimeout),
            (nameof(SecurityTests.EndpointIsPinnedToCanonicalHost), SecurityTests.EndpointIsPinnedToCanonicalHost),
            (nameof(LoopbackTests.CorsPnaAndHostAreStrict), LoopbackTests.CorsPnaAndHostAreStrict),
            (nameof(LoopbackTests.PairActivateStatusAndDisconnectAreOriginBound), LoopbackTests.PairActivateStatusAndDisconnectAreOriginBound),
            (nameof(LoopbackTests.InvalidBodiesFailBeforePairing), LoopbackTests.InvalidBodiesFailBeforePairing),
            (nameof(LoopbackTests.RuntimeFaultCannotRemainFalselyActive), LoopbackTests.RuntimeFaultCannotRemainFalselyActive),
        };

        var failed = 0;
        foreach (var (name, run) in tests)
        {
            try
            {
                await run();
                Console.WriteLine($"PASS {name}");
            }
            catch (Exception error)
            {
                failed++;
                Console.Error.WriteLine($"FAIL {name}: {error.Message}");
            }
        }

        Console.WriteLine($"Presenter Bridge tests: {tests.Length - failed}/{tests.Length} passed.");
        return failed == 0 ? 0 : 1;
    }
}
