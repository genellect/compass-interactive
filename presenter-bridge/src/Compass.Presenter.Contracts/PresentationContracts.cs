namespace Compass.Presenter.Contracts;

public enum PresentationRangeMode
{
    Unknown = 0,
    AllSlides = 1,
    SlideRange = 2,
    CustomShow = 3,
}

public enum PresentationWindowMode
{
    Unknown = 0,
    Speaker = 1,
    Window = 2,
    Kiosk = 3,
    Windowed = 4,
}

public sealed record PresentationObservation(
    string PowerPointProcessInstance,
    string PresentationInstance,
    string DeckBindingDigest,
    string PptxFileSha256,
    string SlideIdOrderSha256,
    string DisplayName,
    IReadOnlyList<int> OrderedSlideIds,
    int CurrentSlideId,
    int CurrentSlideIndex,
    int SlideCount,
    bool HasHiddenSlides,
    int HiddenSlideCount,
    PresentationRangeMode RangeMode,
    PresentationWindowMode WindowMode,
    bool PresenterViewEnabled,
    long ObservedMonotonicTimestamp);

public sealed record BoundPresentation(
    string DeckBindingDigest,
    string PresentationInstance,
    IReadOnlyList<int> OrderedSlideIds,
    int SlideCount);

public sealed record StablePageState(
    string DeckBindingDigest,
    int PageNumber,
    int SlideId,
    long ObservedMonotonicTimestamp);

public sealed record PageUpdateEnvelope(
    Guid ConnectorEpoch,
    Guid EventId,
    long Sequence,
    StablePageState State);

public sealed record PresentationEligibility(
    bool Eligible,
    IReadOnlyList<string> Issues);

public interface IPresentationObservationSource : IAsyncDisposable
{
    event EventHandler? ReconcileRequested;

    ValueTask<PresentationObservation?> ObserveAsync(
        CancellationToken cancellationToken);
}

public interface IPageUpdateSink
{
    ValueTask SendAsync(
        PageUpdateEnvelope update,
        CancellationToken cancellationToken);
}
