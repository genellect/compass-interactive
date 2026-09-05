using System.Diagnostics;
using System.Linq.Expressions;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using Compass.Presenter.Contracts;

namespace Compass.Presenter.PowerPoint.External;

[SupportedOSPlatform("windows10.0.19041")]
public sealed class PowerPointComObservationSource : IPresentationObservationSource
{
    private const int PowerPointRangeAll = 1;
    private const int MsoTrue = -1;
    private static readonly long DeepScanIntervalTicks =
        checked((long)(2 * Stopwatch.Frequency));

    private readonly Thread staThread;
    private readonly TaskCompletionSource<SynchronizationContext> dispatcherReady =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource<Exception?> dispatcherStopped =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly List<(EventInfo Event, Delegate Handler)> eventHandlers = [];
    private readonly PowerPointObservationIdentityGuard identityGuard = new();
    private SynchronizationContext? dispatcher;
    private object? powerPointApplication;
    private nint retainedPresentationIdentity;
    private DeckSnapshot? snapshot;
    private string? cachedFilePath;
    private string? cachedFileSha256;
    private long cachedFileLength = -1;
    private long cachedFileWriteTicks = -1;
    private bool disposed;
    private long lastDeepScanAt;

    public PowerPointComObservationSource()
    {
        staThread = new Thread(RunStaThread)
        {
            IsBackground = true,
            Name = "COMPASS PowerPoint COM STA",
        };
        staThread.SetApartmentState(ApartmentState.STA);
        staThread.Start();
    }

    public event EventHandler? ReconcileRequested;

    public bool EventAccelerationAvailable { get; private set; }

    public async ValueTask<PresentationObservation?> ObserveAsync(
        CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(disposed, this);
        var context = await dispatcherReady.Task.WaitAsync(cancellationToken)
            .ConfigureAwait(false);
        ThrowIfDispatcherStopped();
        var completion = new TaskCompletionSource<PresentationObservation?>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        context.Post(
            _ =>
            {
                try
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    completion.TrySetResult(ObserveOnStaThread());
                }
                catch (OperationCanceledException)
                {
                    completion.TrySetCanceled(cancellationToken);
                }
                catch (Exception error)
                {
                    completion.TrySetException(error);
                }
            },
            null);
        var completed = await Task.WhenAny(completion.Task, dispatcherStopped.Task)
            .WaitAsync(cancellationToken)
            .ConfigureAwait(false);
        if (completed == dispatcherStopped.Task)
        {
            ThrowIfDispatcherStopped();
        }
        return await completion.Task.WaitAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    public async ValueTask DisposeAsync()
    {
        if (disposed)
        {
            return;
        }

        disposed = true;
        SynchronizationContext context;
        try
        {
            context = await dispatcherReady.Task.ConfigureAwait(false);
        }
        catch
        {
            return;
        }

        if (dispatcherStopped.Task.IsCompleted)
        {
            await Task.Run(() => staThread.Join(TimeSpan.FromSeconds(5)))
                .ConfigureAwait(false);
            return;
        }

        var completion = new TaskCompletionSource(
            TaskCreationOptions.RunContinuationsAsynchronously);
        context.Post(
            _ =>
            {
                try
                {
                    DetachFromPowerPoint();
                    System.Windows.Forms.Application.ExitThread();
                    completion.TrySetResult();
                }
                catch (Exception error)
                {
                    completion.TrySetException(error);
                }
            },
            null);
        var completed = await Task.WhenAny(
                completion.Task,
                dispatcherStopped.Task,
                Task.Delay(TimeSpan.FromSeconds(5)))
            .ConfigureAwait(false);
        if (completed == completion.Task)
        {
            await completion.Task.ConfigureAwait(false);
        }
        await Task.Run(() => staThread.Join(TimeSpan.FromSeconds(5)))
            .ConfigureAwait(false);
    }

    private void RunStaThread()
    {
        Exception? terminalError = null;
        try
        {
            using var dispatcherControl = new System.Windows.Forms.Control();
            dispatcherControl.CreateControl();
            dispatcher = new System.Windows.Forms.WindowsFormsSynchronizationContext();
            SynchronizationContext.SetSynchronizationContext(dispatcher);
            dispatcherReady.TrySetResult(dispatcher);
            System.Windows.Forms.Application.Run();
        }
        catch (Exception error)
        {
            terminalError = error;
            dispatcherReady.TrySetException(error);
        }
        finally
        {
            try
            {
                DetachFromPowerPoint();
            }
            catch (Exception error)
            {
                terminalError ??= error;
            }
            dispatcherStopped.TrySetResult(terminalError);
        }
    }

    private void ThrowIfDispatcherStopped()
    {
        if (!dispatcherStopped.Task.IsCompleted)
        {
            return;
        }

        var error = dispatcherStopped.Task.GetAwaiter().GetResult();
        throw new InvalidOperationException(
            "The PowerPoint COM dispatcher is no longer available.",
            error);
    }

    private PresentationObservation? ObserveOnStaThread()
    {
        if (powerPointApplication is null && !TryAttachToPowerPoint())
        {
            return null;
        }

        object? slideShowWindows = null;
        object? slideShowWindow = null;
        object? presentation = null;
        object? view = null;
        object? currentSlide = null;
        object? currentSlideParent = null;
        try
        {
            dynamic application = powerPointApplication!;
            slideShowWindows = application.SlideShowWindows;
            dynamic windows = slideShowWindows;
            var windowCount = Convert.ToInt32(windows.Count);
            if (windowCount == 0)
            {
                snapshot = null;
                return null;
            }

            if (windowCount != 1)
            {
                throw new InvalidOperationException(
                    "More than one PowerPoint slide show is active.");
            }

            slideShowWindow = windows.Item(1);
            dynamic window = slideShowWindow;
            presentation = window.Presentation;
            view = window.View;
            dynamic currentView = view;
            currentSlide = currentView.Slide;
            dynamic slide = currentSlide;
            var currentSlideId = Convert.ToInt32(slide.SlideID);
            var currentSlideIndex = Convert.ToInt32(slide.SlideIndex);
            var observedAt = Stopwatch.GetTimestamp();

            dynamic deck = presentation;
            var file = RequireSavedPresentation(presentation);
            var processInstance = GetPowerPointProcessInstance(slideShowWindow);
            var presentationIdentity = RetainPresentationIdentity(presentation);
            currentSlideParent = slide.Parent;
            var slideParentIdentity = Marshal.GetIUnknownForObject(currentSlideParent);
            try
            {
                PowerPointObservationIdentityGuard.RequireSamePresentation(
                    presentationIdentity, slideParentIdentity);
            }
            finally
            {
                _ = Marshal.Release(slideParentIdentity);
            }
            var identityChanged = identityGuard.Observe(
                processInstance,
                presentationIdentity,
                file.FullName,
                file.Length,
                file.LastWriteTimeUtc.Ticks);
            object? slidesForCount = null;
            int slideCount;
            try
            {
                slidesForCount = deck.Slides;
                dynamic slides = slidesForCount;
                slideCount = Convert.ToInt32(slides.Count);
            }
            finally
            {
                ReleaseComObject(slidesForCount);
            }

            if (snapshot is null || identityChanged ||
                snapshot.SlideCount != slideCount ||
                observedAt - lastDeepScanAt >= DeepScanIntervalTicks)
            {
                snapshot = ScanDeck(
                    presentation,
                    file,
                    processInstance,
                    identityGuard.Instance,
                    observedAt);
                lastDeepScanAt = observedAt;
            }

            return new PresentationObservation(
                snapshot.PowerPointProcessInstance,
                snapshot.PresentationInstance,
                snapshot.DeckBindingDigest,
                snapshot.PptxFileSha256,
                snapshot.SlideIdOrderSha256,
                snapshot.DisplayName,
                snapshot.OrderedSlideIds,
                currentSlideId,
                currentSlideIndex,
                snapshot.SlideCount,
                snapshot.HasHiddenSlides,
                snapshot.HiddenSlideCount,
                snapshot.RangeMode,
                snapshot.WindowMode,
                snapshot.PresenterViewEnabled,
                observedAt);
        }
        catch (COMException)
        {
            DetachFromPowerPoint();
            return null;
        }
        finally
        {
            ReleaseComObject(currentSlideParent);
            ReleaseComObject(currentSlide);
            ReleaseComObject(view);
            ReleaseComObject(presentation);
            ReleaseComObject(slideShowWindow);
            ReleaseComObject(slideShowWindows);
        }
    }

    private DeckSnapshot ScanDeck(
        object presentationObject,
        FileInfo file,
        string processInstance,
        string presentationInstance,
        long observedAt)
    {
        dynamic presentation = presentationObject;
        var displayName = file.Name;
        var fileHash = GetFileHash(file);
        var slideIds = new List<int>();
        var hiddenSlideIds = new List<int>();
        var hiddenSlideCount = 0;
        object? slidesObject = null;
        object? settingsObject = null;
        try
        {
            slidesObject = presentation.Slides;
            dynamic slides = slidesObject;
            var count = Convert.ToInt32(slides.Count);
            for (var index = 1; index <= count; index++)
            {
                object? slideObject = null;
                object? transitionObject = null;
                try
                {
                    slideObject = slides.Item(index);
                    dynamic slide = slideObject;
                    var slideId = Convert.ToInt32(slide.SlideID);
                    slideIds.Add(slideId);
                    transitionObject = slide.SlideShowTransition;
                    dynamic transition = transitionObject;
                    if (Convert.ToInt32(transition.Hidden) == MsoTrue)
                    {
                        hiddenSlideCount++;
                        hiddenSlideIds.Add(slideId);
                    }
                }
                finally
                {
                    ReleaseComObject(transitionObject);
                    ReleaseComObject(slideObject);
                }
            }

            settingsObject = presentation.SlideShowSettings;
            dynamic settings = settingsObject;
            var rangeMode = (PresentationRangeMode)Convert.ToInt32(
                settings.RangeType);
            var windowMode = (PresentationWindowMode)Convert.ToInt32(
                settings.ShowType);
            var presenterView = Convert.ToInt32(settings.ShowPresenterView) ==
                MsoTrue;
            var bindingDigest = CreateDigest(
                $"{fileHash}|{string.Join(',', slideIds)}|" +
                $"hidden:{string.Join(',', hiddenSlideIds)}|{rangeMode}|" +
                $"{windowMode}|{presenterView}");
            var slideIdOrderDigest = CreateDigest(string.Join(',', slideIds));

            return new DeckSnapshot(
                processInstance,
                presentationInstance,
                bindingDigest,
                fileHash,
                slideIdOrderDigest,
                displayName,
                slideIds.ToArray(),
                slideIds.Count,
                hiddenSlideCount > 0,
                hiddenSlideCount,
                rangeMode,
                windowMode,
                presenterView,
                observedAt);
        }
        finally
        {
            ReleaseComObject(settingsObject);
            ReleaseComObject(slidesObject);
        }
    }

    private bool TryAttachToPowerPoint()
    {
        var classIdResult = CLSIDFromProgID("PowerPoint.Application", out var classId);
        if (classIdResult < 0)
        {
            Marshal.ThrowExceptionForHR(classIdResult);
        }

        var activeResult = GetActiveObject(ref classId, IntPtr.Zero, out var application);
        if (activeResult == unchecked((int)0x800401E3))
        {
            return false;
        }

        if (activeResult < 0)
        {
            Marshal.ThrowExceptionForHR(activeResult);
        }

        powerPointApplication = application;
        EventAccelerationAvailable = TryAttachEventAcceleration(application);
        ReconcileRequested?.Invoke(this, EventArgs.Empty);
        return true;
    }

    private bool TryAttachEventAcceleration(object application)
    {
        try
        {
            var assembly = Assembly.Load(
                "Microsoft.Office.Interop.PowerPoint, Version=15.0.0.0, " +
                "Culture=neutral, PublicKeyToken=71e9bce111e9429c");
            var eventInterface = assembly.GetType(
                "Microsoft.Office.Interop.PowerPoint.EApplication_Event",
                throwOnError: true)!;
            foreach (var eventName in new[]
            {
                "SlideShowNextSlide",
                "SlideShowNextBuild",
                "SlideShowBegin",
                "SlideShowEnd",
                "PresentationSave",
                "PresentationClose",
                "WindowSelectionChange",
            })
            {
                var eventInfo = eventInterface.GetEvent(eventName);
                if (eventInfo?.EventHandlerType is null)
                {
                    continue;
                }

                var handler = BuildEventHandler(eventInfo.EventHandlerType);
                eventInfo.AddEventHandler(application, handler);
                eventHandlers.Add((eventInfo, handler));
            }

            return eventHandlers.Count > 0;
        }
        catch
        {
            foreach (var (eventInfo, handler) in eventHandlers)
            {
                try
                {
                    eventInfo.RemoveEventHandler(application, handler);
                }
                catch
                {
                }
            }
            eventHandlers.Clear();
            return false;
        }
    }

    private Delegate BuildEventHandler(Type delegateType)
    {
        var invoke = delegateType.GetMethod("Invoke") ??
            throw new InvalidOperationException("PowerPoint event delegate is invalid.");
        var parameters = invoke.GetParameters()
            .Select(parameter => Expression.Parameter(parameter.ParameterType))
            .ToArray();
        var callback = Expression.Call(
            Expression.Constant(this),
            typeof(PowerPointComObservationSource).GetMethod(
                nameof(RaiseReconcileRequested),
                BindingFlags.Instance | BindingFlags.NonPublic)!);
        return Expression.Lambda(delegateType, callback, parameters).Compile();
    }

    private void RaiseReconcileRequested() =>
        ReconcileRequested?.Invoke(this, EventArgs.Empty);

    private void DetachFromPowerPoint()
    {
        if (powerPointApplication is not null)
        {
            foreach (var (eventInfo, handler) in eventHandlers)
            {
                try
                {
                    eventInfo.RemoveEventHandler(powerPointApplication, handler);
                }
                catch
                {
                }
            }
        }

        eventHandlers.Clear();
        EventAccelerationAvailable = false;
        snapshot = null;
        identityGuard.Reset();
        if (retainedPresentationIdentity != 0)
        {
            _ = Marshal.Release(retainedPresentationIdentity);
            retainedPresentationIdentity = 0;
        }
        lastDeepScanAt = 0;
        cachedFilePath = null;
        cachedFileSha256 = null;
        cachedFileLength = -1;
        cachedFileWriteTicks = -1;
        ReleaseComObject(powerPointApplication);
        powerPointApplication = null;
    }

    internal static nint ReadSlideShowWindowHandle(object slideShowWindow)
    {
        dynamic window = slideShowWindow;
        var handle = new IntPtr(Convert.ToInt64(window.HWND));
        if (handle == IntPtr.Zero)
            throw new InvalidOperationException("The PowerPoint slide show window is unavailable.");
        return handle;
    }

    private static string GetPowerPointProcessInstance(object slideShowWindow)
    {
        return ResolveWindowOrSingleProcess(() =>
        {
            var windowHandle = ReadSlideShowWindowHandle(slideShowWindow);
            if (GetWindowThreadProcessId(windowHandle, out var processId) == 0 || processId == 0)
                throw new InvalidOperationException("The PowerPoint slide show process is unavailable.");
            using var process = Process.GetProcessById(checked((int)processId));
            return $"{processId}:{process.StartTime.ToUniversalTime().Ticks}";
        }, () =>
        {
            using var current = Process.GetCurrentProcess();
            var processes = Process.GetProcessesByName("POWERPNT");
            try
            {
                return processes.Where(process => process.SessionId == current.SessionId)
                    .Select(process => $"{process.Id}:{process.StartTime.ToUniversalTime().Ticks}")
                    .ToArray();
            }
            finally
            {
                foreach (var process in processes) process.Dispose();
            }
        });
    }

    internal static string ResolveWindowOrSingleProcess(
        Func<string> readWindowProcess, Func<IReadOnlyList<string>> readSameSessionProcesses)
    {
        try
        {
            return readWindowProcess();
        }
        catch (MissingMemberException)
        {
            // Some Office 16 COM surfaces omit HWND, even by its type-library
            // DISPID. Only an unambiguous PowerPoint process in this Windows
            // session may replace that unavailable lookup. Never guess by focus.
            var candidates = readSameSessionProcesses();
            if (candidates.Count != 1)
                throw new InvalidOperationException("The PowerPoint process identity is ambiguous.");
            return candidates[0];
        }
    }

    private static FileInfo RequireSavedPresentation(object presentationObject)
    {
        dynamic presentation = presentationObject;
        var fullName = Convert.ToString(presentation.FullName) ?? string.Empty;
        if (string.IsNullOrWhiteSpace(fullName) || !File.Exists(fullName))
        {
            throw new InvalidOperationException(
                "The PowerPoint presentation must be saved before pairing.");
        }
        var file = new FileInfo(fullName);
        file.Refresh();
        return file;
    }

    private nint RetainPresentationIdentity(object presentation)
    {
        var observedIdentity = Marshal.GetIUnknownForObject(presentation);
        if (observedIdentity == retainedPresentationIdentity)
        {
            _ = Marshal.Release(observedIdentity);
            return retainedPresentationIdentity;
        }

        if (retainedPresentationIdentity != 0)
        {
            _ = Marshal.Release(retainedPresentationIdentity);
        }
        // Retain one COM reference so a closed deck's address cannot be reused
        // and confused with another deck between consecutive observations.
        retainedPresentationIdentity = observedIdentity;
        return retainedPresentationIdentity;
    }

    private static string ComputeFileHash(string path)
    {
        using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete,
            64 * 1024,
            FileOptions.SequentialScan);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    private string GetFileHash(FileInfo file)
    {
        file.Refresh();
        var length = file.Length;
        var lastWriteTicks = file.LastWriteTimeUtc.Ticks;
        if (cachedFileSha256 is not null &&
            string.Equals(
                cachedFilePath,
                file.FullName,
                StringComparison.OrdinalIgnoreCase) &&
            cachedFileLength == length &&
            cachedFileWriteTicks == lastWriteTicks)
        {
            return cachedFileSha256;
        }

        var hash = ComputeFileHash(file.FullName);
        file.Refresh();
        if (file.Length != length || file.LastWriteTimeUtc.Ticks != lastWriteTicks)
        {
            throw new InvalidOperationException(
                "The PowerPoint file changed while its fingerprint was read.");
        }

        cachedFilePath = file.FullName;
        cachedFileLength = length;
        cachedFileWriteTicks = lastWriteTicks;
        cachedFileSha256 = hash;
        return hash;
    }

    private static string CreateDigest(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)))
            .ToLowerInvariant();

    private static void ReleaseComObject(object? value)
    {
        if (value is null || !Marshal.IsComObject(value))
        {
            return;
        }

        try
        {
            _ = Marshal.ReleaseComObject(value);
        }
        catch
        {
        }
    }

    [DllImport("ole32.dll", CharSet = CharSet.Unicode)]
    private static extern int CLSIDFromProgID(
        string programId,
        out Guid classId);

    [DllImport("oleaut32.dll")]
    private static extern int GetActiveObject(
        ref Guid classId,
        IntPtr reserved,
        [MarshalAs(UnmanagedType.IUnknown)] out object application);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(
        IntPtr windowHandle,
        out uint processId);

    private sealed record DeckSnapshot(
        string PowerPointProcessInstance,
        string PresentationInstance,
        string DeckBindingDigest,
        string PptxFileSha256,
        string SlideIdOrderSha256,
        string DisplayName,
        IReadOnlyList<int> OrderedSlideIds,
        int SlideCount,
        bool HasHiddenSlides,
        int HiddenSlideCount,
        PresentationRangeMode RangeMode,
        PresentationWindowMode WindowMode,
        bool PresenterViewEnabled,
        long ObservedAt);
}
