using System.Text.Json.Serialization;
using Compass.Presenter.Contracts;

namespace Compass.Presenter.Loopback;

public static class PresenterIssueCodes
{
    public const string PdfPageCountInvalid = "pdf_page_count_invalid";
    public const string PageCountMismatch = "page_count_mismatch";
    public const string SlideIdOrderInvalid = "slide_id_order_invalid";
    public const string HiddenSlidesUnsupported = "hidden_slides_unsupported";
    public const string CustomOrPartialShowUnsupported =
        "custom_or_partial_show_unsupported";
    public const string WindowedSlideShowRequired =
        "windowed_slide_show_required";
    public const string PresenterViewMustBeDisabled =
        "presenter_view_must_be_disabled";
    public const string CurrentSlideOrderMismatch =
        "current_slide_order_mismatch";
    public const string PowerPointNotRunning = "powerpoint_not_running";
    public const string MultipleSlideShows = "multiple_slide_shows";
    public const string PresentationChanged = "presentation_changed";
    public const string PresenterSessionStopped = "presenter_session_stopped";
}

public sealed record ConnectRequest
{
    public string? Action { get; init; }
    public string? BindingDigest { get; init; }
    public string? Ticket { get; init; }
    public Guid? LectureSessionId { get; init; }
    public string? PdfDocumentId { get; init; }
    public string? PdfDocumentVersion { get; init; }
    public int? PdfPageCount { get; init; }
}

public sealed record PresentationResponse(
    string BindingDigest,
    string DisplayName,
    int SlideCount,
    int CurrentSlideIndex,
    bool Eligible,
    IReadOnlyList<string> Issues);

public sealed record ConnectResponse(
    bool Ok,
    string State,
    string SessionToken,
    PresentationResponse Presentation);

public sealed record PresentationEnvelope(
    bool Ok,
    PresentationResponse Presentation);

public sealed record StatusResponse(
    bool Ok,
    string State,
    PresentationResponse? Presentation,
    string? LastErrorCode);

public sealed record StateResponse(bool Ok, string State);

public sealed record ErrorResponse(bool Ok, string Message, string Code);

public sealed record PairingTicketClaims(
    Guid LectureSessionId,
    string PdfDocumentId,
    string PdfDocumentVersion,
    int PdfPageCount,
    DateTimeOffset ExpiresAt)
{
    public Guid ConnectionId { get; init; }

    public DateTimeOffset HardStopAt { get; init; }

    // Kept only in process memory until the confirmed connection is claimed.
    [JsonIgnore]
    public string? PairingCredential { get; init; }

    [JsonIgnore]
    public bool UsesManualCode { get; init; }

    public override string ToString() =>
        "PairingTicketClaims { PairingCredential = [redacted] }";
}

public sealed record PresenterSessionActivation(
    PairingTicketClaims Claims,
    PresentationResponse Presentation);

public sealed record PresenterSessionActivationResult(DateTimeOffset ExpiresAt);

public interface IPresenterSessionActivationHandler
{
    ValueTask<PresenterSessionActivationResult> ActivateAsync(
        PresenterSessionActivation activation,
        CancellationToken cancellationToken);

    ValueTask DisconnectAsync(
        Guid connectionId,
        CancellationToken cancellationToken);
}

public sealed class PresenterSessionFaultedEventArgs : EventArgs
{
    public PresenterSessionFaultedEventArgs(Guid connectionId, string errorCode)
    {
        ConnectionId = connectionId;
        ErrorCode = errorCode;
    }

    public Guid ConnectionId { get; }

    public string ErrorCode { get; }
}

public interface IPresenterSessionFaultSource
{
    event EventHandler<PresenterSessionFaultedEventArgs>? SessionFaulted;
}

public interface IPairingTicketVerifier
{
    ValueTask<PairingTicketClaims?> VerifyAndConsumeAsync(
        string ticket,
        Guid lectureSessionId,
        string pdfDocumentId,
        string pdfDocumentVersion,
        int pdfPageCount,
        string origin,
        CancellationToken cancellationToken);
}

public sealed class RejectAllPairingTicketVerifier : IPairingTicketVerifier
{
    public ValueTask<PairingTicketClaims?> VerifyAndConsumeAsync(
        string ticket,
        Guid lectureSessionId,
        string pdfDocumentId,
        string pdfDocumentVersion,
        int pdfPageCount,
        string origin,
        CancellationToken cancellationToken) =>
        ValueTask.FromResult<PairingTicketClaims?>(null);
}
