using Compass.Presenter.Contracts;

namespace Compass.Presenter.Core;

public static class PresentationEligibilityEvaluator
{
    public static PresentationEligibility Evaluate(
        PresentationObservation observation,
        int expectedPdfPageCount)
    {
        var issues = new List<string>();
        if (expectedPdfPageCount is < 1 or > 75)
        {
            issues.Add("pdf_page_count_invalid");
        }

        if (observation.SlideCount != expectedPdfPageCount)
        {
            issues.Add("page_count_mismatch");
        }

        if (observation.OrderedSlideIds.Count != observation.SlideCount ||
            observation.OrderedSlideIds.Distinct().Count() != observation.SlideCount)
        {
            issues.Add("slide_id_order_invalid");
        }

        if (observation.HasHiddenSlides)
        {
            issues.Add("hidden_slides_unsupported");
        }

        if (observation.RangeMode != PresentationRangeMode.AllSlides)
        {
            issues.Add("custom_or_partial_show_unsupported");
        }

        if (observation.WindowMode is not (
            PresentationWindowMode.Speaker or PresentationWindowMode.Window or
            PresentationWindowMode.Windowed))
        {
            issues.Add("windowed_slide_show_required");
        }

        if (observation.PresenterViewEnabled)
        {
            issues.Add("presenter_view_must_be_disabled");
        }

        if (observation.CurrentSlideIndex is < 1 ||
            observation.CurrentSlideIndex > observation.SlideCount ||
            observation.OrderedSlideIds.Count < observation.CurrentSlideIndex ||
            observation.OrderedSlideIds[observation.CurrentSlideIndex - 1] !=
                observation.CurrentSlideId)
        {
            issues.Add("current_slide_order_mismatch");
        }

        return new PresentationEligibility(issues.Count == 0, issues);
    }
}
