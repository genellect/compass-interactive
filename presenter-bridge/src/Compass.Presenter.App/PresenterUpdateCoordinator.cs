namespace Compass.Presenter.App;

internal interface IPresenterUpdater
{
    Task<bool> CheckAsync(CancellationToken cancellationToken);
    Task InstallAsync(CancellationToken cancellationToken);
}

internal sealed class PresenterUpdateCoordinator(
    SemaphoreSlim activityGate,
    Func<bool> hasLiveBrowserSession,
    Func<Func<CancellationToken, Task>, CancellationToken, Task<bool>> runWhenIdle,
    IPresenterUpdater updater)
{
    public event Action<bool>? AvailabilityChanged;

    public Task<bool> CheckAsync(CancellationToken cancellationToken) =>
        RunAsync(install: false, cancellationToken);

    public Task<bool> InstallAsync(CancellationToken cancellationToken) =>
        RunAsync(install: true, cancellationToken);

    private async Task<bool> RunAsync(
        bool install,
        CancellationToken cancellationToken)
    {
        if (!await activityGate.WaitAsync(0, cancellationToken).ConfigureAwait(false))
        {
            return false;
        }
        try
        {
            if (hasLiveBrowserSession())
            {
                return false;
            }
            return await runWhenIdle(async token =>
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
                timeout.CancelAfter(install ? TimeSpan.FromMinutes(2) : TimeSpan.FromSeconds(5));
                var available = await updater.CheckAsync(timeout.Token).ConfigureAwait(false);
                AvailabilityChanged?.Invoke(available);
                if (install && available)
                {
                    timeout.Token.ThrowIfCancellationRequested();
                    await updater.InstallAsync(timeout.Token).ConfigureAwait(false);
                }
            }, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            activityGate.Release();
        }
    }
}
