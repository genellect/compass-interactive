using Compass.Presenter.Core;
using Compass.Presenter.PowerPoint.External;

namespace Compass.Presenter.Tests;

internal static class PowerPointIdentityTests
{
    public static Task DisplayedSlideMustBelongToObservedPresentation()
    {
        PowerPointObservationIdentityGuard.RequireSamePresentation(100, 100);
        Assert.Throws<InvalidOperationException>(() =>
            PowerPointObservationIdentityGuard.RequireSamePresentation(100, 200));
        Assert.Throws<InvalidOperationException>(() =>
            PowerPointObservationIdentityGuard.RequireSamePresentation(0, 100));
        Assert.Throws<InvalidOperationException>(() =>
            PowerPointObservationIdentityGuard.RequireSamePresentation(100, 0));
        Assert.Throws<InvalidOperationException>(() =>
            PowerPointObservationIdentityGuard.RequireSamePresentation(0, 0));
        return Task.CompletedTask;
    }

    [System.Runtime.Versioning.SupportedOSPlatform("windows10.0.19041")]
    public static Task ShowWindowIdentitySupportsOffice32BitHandlesAndRejectsZero()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041))
            throw new PlatformNotSupportedException("Presenter requires Windows 10 2004 or later.");
        dynamic show = new System.Dynamic.ExpandoObject();
        show.HWND = unchecked((int)0x80001234);
        Assert.Equal(new IntPtr(unchecked((int)0x80001234)),
            PowerPointComObservationSource.ReadSlideShowWindowHandle((object)show));
        show.HWND = 0;
        Assert.Throws<InvalidOperationException>(() =>
            PowerPointComObservationSource.ReadSlideShowWindowHandle((object)show));
        Assert.Equal("1234:5678", PowerPointComObservationSource.ResolveWindowOrSingleProcess(
            () => throw new MissingMemberException("HWND"), () => ["1234:5678"]));
        Assert.Throws<InvalidOperationException>(() =>
            PowerPointComObservationSource.ResolveWindowOrSingleProcess(
                () => throw new MissingMemberException("HWND"), () => []));
        Assert.Throws<InvalidOperationException>(() =>
            PowerPointComObservationSource.ResolveWindowOrSingleProcess(
                () => throw new MissingMemberException("HWND"), () => ["1234:5678", "2222:3333"]));
        Assert.Throws<System.Runtime.InteropServices.COMException>(() =>
            PowerPointComObservationSource.ResolveWindowOrSingleProcess(
                () => throw new System.Runtime.InteropServices.COMException("RPC unavailable"),
                () => throw new Exception("A transport fault must not use another window.")));
        return Task.CompletedTask;
    }

    public static Task SameCountDeckSwitchInvalidatesBeforeNextDeepScan()
    {
        var guard = new PowerPointObservationIdentityGuard();
        Assert.True(guard.Observe("process-1", 100, "C:\\lecture-a.pptx", 500, 1000));
        var firstInstance = guard.Instance;
        var tracker = new StablePresentationTracker(TimeSpan.FromMilliseconds(100));
        tracker.Bind(TestData.Observation(1, 0) with
        {
            PresentationInstance = firstInstance,
        }, TestData.SlideIds.Length);

        Assert.False(guard.Observe("process-1", 100, "c:\\LECTURE-A.pptx", 500, 1000));
        Assert.Equal(firstInstance, guard.Instance);
        // Even an identically sized copy with the same Slide IDs changes identity
        // immediately, without waiting for the two-second content scan.
        Assert.True(guard.Observe("process-1", 200, "C:\\lecture-b.pptx", 500, 1000));
        Assert.False(firstInstance == guard.Instance);
        Assert.Throws<PresentationBindingChangedException>(() =>
            tracker.Observe(TestData.Observation(2, TestData.Milliseconds(200)) with
            {
                PresentationInstance = guard.Instance,
            }));
        return Task.CompletedTask;
    }

    public static Task SaveReopenAndComReattachReplaceIdentity()
    {
        var guard = new PowerPointObservationIdentityGuard();
        guard.Observe("process-1", 100, "C:\\lecture.pptx", 500, 1000);
        var original = guard.Instance;
        Assert.True(guard.Observe("process-1", 100, "C:\\lecture.pptx", 500, 2000));
        Assert.False(original == guard.Instance);
        var saved = guard.Instance;
        Assert.True(guard.Observe("process-1", 200, "C:\\lecture.pptx", 500, 2000));
        Assert.False(saved == guard.Instance);
        var reopened = guard.Instance;
        guard.Reset();
        Assert.True(guard.Observe("process-1", 200, "C:\\lecture.pptx", 500, 2000));
        Assert.False(reopened == guard.Instance);
        return Task.CompletedTask;
    }
}
