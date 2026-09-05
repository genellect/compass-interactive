namespace Compass.Presenter.Tests;

internal static class Program
{
    public static async Task<int> Main()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041))
            throw new PlatformNotSupportedException("Presenter requires Windows 10 2004 or later.");
        var tests = new (string Name, Func<Task> Run)[]
        {
            (nameof(CoreTests.OrdinaryFullScreenSupportsStablePagesButNotKioskOrPresenterView), CoreTests.OrdinaryFullScreenSupportsStablePagesButNotKioskOrPresenterView),
            (nameof(PowerPointIdentityTests.DisplayedSlideMustBelongToObservedPresentation), PowerPointIdentityTests.DisplayedSlideMustBelongToObservedPresentation),
            (nameof(CoreTests.EligibilityRejectsUnsupportedDecks), CoreTests.EligibilityRejectsUnsupportedDecks),
            (nameof(CoreTests.PreTransitionEventNeverCommitsOldSlide), CoreTests.PreTransitionEventNeverCommitsOldSlide),
            (nameof(CoreTests.BindingMutationStopsSynchronization), CoreTests.BindingMutationStopsSynchronization),
            (nameof(CoreTests.ReopenedSameDeckStopsSynchronization), CoreTests.ReopenedSameDeckStopsSynchronization),
            (nameof(PowerPointIdentityTests.SameCountDeckSwitchInvalidatesBeforeNextDeepScan), PowerPointIdentityTests.SameCountDeckSwitchInvalidatesBeforeNextDeepScan),
            (nameof(PowerPointIdentityTests.SaveReopenAndComReattachReplaceIdentity), PowerPointIdentityTests.SaveReopenAndComReattachReplaceIdentity),
            (nameof(PowerPointIdentityTests.ShowWindowIdentitySupportsOffice32BitHandlesAndRejectsZero), PowerPointIdentityTests.ShowWindowIdentitySupportsOffice32BitHandlesAndRejectsZero),
            (nameof(CoreTests.FixedSeedTenThousandTraceConverges), CoreTests.FixedSeedTenThousandTraceConverges),
            (nameof(CoreTests.FiveHundredTransitionEquivalentHasNoWrongPage), CoreTests.FiveHundredTransitionEquivalentHasNoWrongPage),
            (nameof(CoreTests.LatestOnlyDispatcherDropsIntermediatePage), CoreTests.LatestOnlyDispatcherDropsIntermediatePage),
            (nameof(CoreTests.RetryReusesEventIdentity), CoreTests.RetryReusesEventIdentity),
            (nameof(CoreTests.ReturnToAcknowledgedPageSurvivesInFlightCommit), CoreTests.ReturnToAcknowledgedPageSurvivesInFlightCommit),
            (nameof(CoreTests.ReturnToAcknowledgedPageRepairsLostCommitResponse), CoreTests.ReturnToAcknowledgedPageRepairsLostCommitResponse),
            (nameof(CoreTests.MissingSlideShowFaultsWithinGrace), CoreTests.MissingSlideShowFaultsWithinGrace),
            (nameof(CoreTests.HungObservationFaultsWithinTimeout), CoreTests.HungObservationFaultsWithinTimeout),
            (nameof(SecurityTests.EndpointIsPinnedToCanonicalHost), SecurityTests.EndpointIsPinnedToCanonicalHost),
            (nameof(SecurityTests.ReleaseIgnoresEndpointAndOriginOverrides), SecurityTests.ReleaseIgnoresEndpointAndOriginOverrides),
            (nameof(UpdateTests.UpdateRefusesInspectPendingAndActiveConnection), UpdateTests.UpdateRefusesInspectPendingAndActiveConnection),
            (nameof(UpdateTests.UpdateKeepsAdmissionLockedAndCancellationReleasesIt), UpdateTests.UpdateKeepsAdmissionLockedAndCancellationReleasesIt),
            (nameof(UpdateTests.UpdateFeedRejectsForeignUrlsRedirectAndOversize), UpdateTests.UpdateFeedRejectsForeignUrlsRedirectAndOversize),
            (nameof(UpdateTests.PackageSignaturesBindPublisherExactBytesAndCachedFile), UpdateTests.PackageSignaturesBindPublisherExactBytesAndCachedFile),
            (nameof(UpdateTests.SignedPackageMetadataRejectsFeedVersionSpoofing), UpdateTests.SignedPackageMetadataRejectsFeedVersionSpoofing),
            (nameof(ReadinessTests.HealthReadinessCachesRefreshesAndBoundsHungCom), ReadinessTests.HealthReadinessCachesRefreshesAndBoundsHungCom),
            (nameof(SecurityTests.RequestProofIsP256BoundToExactBodyAndNonce), SecurityTests.RequestProofIsP256BoundToExactBodyAndNonce),
            (nameof(SecurityTests.TransportRetryReusesProofAndNextCallUsesFreshNonce), SecurityTests.TransportRetryReusesProofAndNextCallUsesFreshNonce),
            (nameof(SecurityTests.RateLimitIsTransientAndPreservesRetryAfter), SecurityTests.RateLimitIsTransientAndPreservesRetryAfter),
            (nameof(SecurityTests.ManualRecoveryRejectsLocalEligibilityBeforeHostedInspect), SecurityTests.ManualRecoveryRejectsLocalEligibilityBeforeHostedInspect),
            (nameof(SecurityTests.WindowsInstallationProofRejectsAndRepairsInvalidUserKey), SecurityTests.WindowsInstallationProofRejectsAndRepairsInvalidUserKey),
            (nameof(SecurityTests.WindowsInstallationProofDeletesRecreatesAndReportsFailure), SecurityTests.WindowsInstallationProofDeletesRecreatesAndReportsFailure),
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
