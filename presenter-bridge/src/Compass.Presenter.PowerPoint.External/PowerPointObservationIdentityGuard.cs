namespace Compass.Presenter.PowerPoint.External;

internal sealed class PowerPointObservationIdentityGuard
{
    private string? processInstance;
    private nint presentationIdentity;
    private string? fullName;
    private long fileLength;
    private long lastWriteTicks;

    public string Instance { get; private set; } = string.Empty;

    public static void RequireSamePresentation(nint showPresentation, nint slideParent)
    {
        if (showPresentation == 0 || slideParent == 0 || showPresentation != slideParent)
        {
            throw new InvalidOperationException(
                "The displayed slide does not belong to the observed presentation.");
        }
    }

    public bool Observe(
        string observedProcessInstance,
        nint observedPresentationIdentity,
        string observedFullName,
        long observedFileLength,
        long observedLastWriteTicks)
    {
        if (processInstance == observedProcessInstance &&
            presentationIdentity == observedPresentationIdentity &&
            string.Equals(fullName, observedFullName,
                StringComparison.OrdinalIgnoreCase) &&
            fileLength == observedFileLength &&
            lastWriteTicks == observedLastWriteTicks)
        {
            return false;
        }

        processInstance = observedProcessInstance;
        presentationIdentity = observedPresentationIdentity;
        fullName = observedFullName;
        fileLength = observedFileLength;
        lastWriteTicks = observedLastWriteTicks;
        Instance = Guid.NewGuid().ToString("N");
        return true;
    }

    public void Reset()
    {
        processInstance = null;
        presentationIdentity = 0;
        fullName = null;
        Instance = string.Empty;
    }
}
