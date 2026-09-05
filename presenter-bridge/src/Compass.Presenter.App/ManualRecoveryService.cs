using Compass.Presenter.Contracts;
using Compass.Presenter.Core;
using Compass.Presenter.Loopback;

namespace Compass.Presenter.App;

internal enum ManualRecoveryStage
{
    Inspecting,
    AwaitingTeacherConfirmation,
    Active,
}

internal sealed class ManualRecoveryService
{
    private readonly EdgePresenterClient client;
    private readonly PresenterSessionCoordinator coordinator;
    private readonly string installationHash;
    private readonly IPresentationObservationSource presentationSource;
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly SemaphoreSlim? activityGate;

    public ManualRecoveryService(
        EdgePresenterClient client,
        PresenterSessionCoordinator coordinator,
        IPresentationObservationSource presentationSource,
        string installationHash,
        SemaphoreSlim? activityGate = null)
    {
        this.client = client;
        this.coordinator = coordinator;
        this.presentationSource = presentationSource;
        this.installationHash = installationHash;
        this.activityGate = activityGate;
    }

    public async Task RecoverAsync(
        string manualCode,
        Action<ManualRecoveryStage> reportStage,
        CancellationToken cancellationToken)
    {
        if (!await gate.WaitAsync(0, cancellationToken).ConfigureAwait(false))
        {
            throw new PresenterRemoteException("recovery_already_running");
        }
        var activityAcquired = false;
        try
        {
            if (activityGate is not null)
            {
                await activityGate.WaitAsync(cancellationToken).ConfigureAwait(false);
                activityAcquired = true;
            }
            reportStage(ManualRecoveryStage.Inspecting);
            var observation = await presentationSource.ObserveAsync(
                cancellationToken).ConfigureAwait(false) ??
                throw new PresenterRemoteException("powerpoint_not_running");
            var localEligibility = PresentationEligibilityEvaluator.Evaluate(
                observation,
                observation.SlideCount);
            if (!localEligibility.Eligible)
            {
                throw new PresenterRemoteException(
                    localEligibility.Issues.FirstOrDefault() ??
                    "presentation_ineligible");
            }
            var claims = await client.InspectManualCodeAsync(
                manualCode,
                installationHash,
                observation,
                cancellationToken).ConfigureAwait(false) ??
                throw new PresenterRemoteException("manual_code_invalid");
            var eligibility = PresentationEligibilityEvaluator.Evaluate(
                observation,
                claims.PdfPageCount);
            if (!eligibility.Eligible)
            {
                throw new PresenterRemoteException(
                    eligibility.Issues.FirstOrDefault() ??
                    "presentation_ineligible");
            }
            var presentation = new PresentationResponse(
                observation.DeckBindingDigest,
                observation.DisplayName,
                observation.SlideCount,
                observation.CurrentSlideIndex,
                eligibility.Eligible,
                eligibility.Issues);
            var activation = new PresenterSessionActivation(
                claims,
                presentation);
            reportStage(ManualRecoveryStage.AwaitingTeacherConfirmation);

            PresenterRemoteException? lastRejection = null;
            while (
                DateTimeOffset.UtcNow < claims.ExpiresAt &&
                DateTimeOffset.UtcNow < claims.HardStopAt)
            {
                cancellationToken.ThrowIfCancellationRequested();
                try
                {
                    await coordinator.ActivateAsync(
                        activation,
                        cancellationToken).ConfigureAwait(false);
                    reportStage(ManualRecoveryStage.Active);
                    return;
                }
                catch (PresenterRemoteException error)
                    when (
                        error.Code == "confirmation_pending" ||
                        error.Code == "rate_limited" ||
                        error.Transient)
                {
                    lastRejection = error;
                    var retryAfter = error.RetryAfter ??
                        (error.Code == "confirmation_pending"
                            ? TimeSpan.FromSeconds(3)
                            : TimeSpan.FromSeconds(2));
                    var remaining = new[]
                    {
                        claims.ExpiresAt,
                        claims.HardStopAt,
                    }.Min() - DateTimeOffset.UtcNow;
                    if (remaining <= retryAfter)
                    {
                        break;
                    }
                    await Task.Delay(
                        retryAfter,
                        cancellationToken).ConfigureAwait(false);
                }
            }
            throw lastRejection ??
                new PresenterRemoteException("manual_code_expired");
        }
        finally
        {
            if (activityAcquired)
            {
                activityGate!.Release();
            }
            gate.Release();
        }
    }
}
