using Compass.Presenter.Contracts;
using Compass.Presenter.Loopback;

namespace Compass.Presenter.App;

internal sealed class EdgePairingTicketVerifier : IPairingTicketVerifier
{
    private readonly EdgePresenterClient client;
    private readonly IPresentationObservationSource presentationSource;
    private readonly string installationHash;

    public EdgePairingTicketVerifier(
        EdgePresenterClient client,
        IPresentationObservationSource presentationSource,
        string installationHash)
    {
        this.client = client;
        this.presentationSource = presentationSource;
        this.installationHash = installationHash;
    }

    public async ValueTask<PairingTicketClaims?> VerifyAndConsumeAsync(
        string ticket,
        Guid lectureSessionId,
        string pdfDocumentId,
        string pdfDocumentVersion,
        int pdfPageCount,
        string origin,
        CancellationToken cancellationToken)
    {
        PresentationObservation? observation;
        try
        {
            observation = await presentationSource.ObserveAsync(cancellationToken)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return null;
        }
        if (observation is null)
        {
            return null;
        }

        try
        {
            return await client.InspectPairingAsync(
                ticket,
                lectureSessionId,
                pdfDocumentId,
                pdfDocumentVersion,
                pdfPageCount,
                origin,
                installationHash,
                observation,
                cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (PresenterRemoteException)
        {
            return null;
        }
    }
}
