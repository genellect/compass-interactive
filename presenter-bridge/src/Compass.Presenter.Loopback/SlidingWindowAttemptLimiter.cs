namespace Compass.Presenter.Loopback;

internal sealed class SlidingWindowAttemptLimiter
{
    private readonly object gate = new();
    private readonly Queue<DateTimeOffset> attempts = new();
    private readonly TimeProvider timeProvider;
    private readonly int limit;
    private readonly TimeSpan window;

    public SlidingWindowAttemptLimiter(
        int limit = 5,
        TimeSpan? window = null,
        TimeProvider? timeProvider = null)
    {
        this.limit = limit;
        this.window = window ?? TimeSpan.FromMinutes(1);
        this.timeProvider = timeProvider ?? TimeProvider.System;
    }

    public bool TryAcquire()
    {
        lock (gate)
        {
            var now = timeProvider.GetUtcNow();
            while (attempts.TryPeek(out var attemptedAt) &&
                attemptedAt + window <= now)
            {
                attempts.Dequeue();
            }

            if (attempts.Count >= limit)
            {
                return false;
            }

            attempts.Enqueue(now);
            return true;
        }
    }
}
