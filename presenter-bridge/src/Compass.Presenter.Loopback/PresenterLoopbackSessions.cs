using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Compass.Presenter.Loopback;

internal sealed partial class PresenterLoopbackSessions
{
    private readonly object gate = new();
    private readonly TimeProvider timeProvider;
    private readonly TimeSpan lifetime;
    private readonly Dictionary<string, Session> sessions = [];

    public PresenterLoopbackSessions(
        TimeProvider? timeProvider = null,
        TimeSpan? lifetime = null)
    {
        this.timeProvider = timeProvider ?? TimeProvider.System;
        this.lifetime = lifetime ?? TimeSpan.FromMinutes(10);
    }

    public static bool IsValidTokenSyntax(string? token) =>
        token is not null && SessionTokenPattern().IsMatch(token);

    public bool HasLiveSession
    {
        get
        {
            lock (gate)
            {
                CleanupExpired();
                return sessions.Values.Any(session =>
                    session.State is "pending_confirmation" or "active");
            }
        }
    }

    public Session Create(
        string origin,
        PairingTicketClaims claims,
        PresentationResponse presentation)
    {
        lock (gate)
        {
            CleanupExpired();
            if (sessions.Values.Any(session =>
                session.State is "pending_confirmation" or "active"))
            {
                throw new InvalidOperationException(
                    "A Presenter connection is already active.");
            }

            var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
                .TrimEnd('=')
                .Replace('+', '-')
                .Replace('/', '_');
            var now = timeProvider.GetUtcNow();
            var expiresAt = new[] { now + lifetime, claims.ExpiresAt }.Min();
            var session = new Session(
                token,
                origin,
                claims,
                presentation,
                "pending_confirmation",
                null,
                expiresAt);
            sessions.Add(token, session);
            return session;
        }
    }

    public Session? Find(string? token, string origin)
    {
        if (!IsValidTokenSyntax(token))
        {
            return null;
        }

        lock (gate)
        {
            CleanupExpired();
            foreach (var (candidate, session) in sessions)
            {
                if (session.Origin == origin && FixedTimeEquals(candidate, token!))
                {
                    return session;
                }
            }

            return null;
        }
    }

    public Session Activate(
        string token,
        string origin,
        string bindingDigest,
        DateTimeOffset expiresAt)
    {
        lock (gate)
        {
            var session = Find(token, origin) ??
                throw new UnauthorizedAccessException();
            if (session.State != "pending_confirmation" ||
                !FixedTimeEquals(
                    session.Presentation.BindingDigest,
                    bindingDigest))
            {
                throw new InvalidOperationException(
                    "Presentation confirmation does not match.");
            }

            if (expiresAt <= timeProvider.GetUtcNow())
            {
                throw new InvalidOperationException(
                    "Presenter capability is already expired.");
            }

            var activated = session with
            {
                Claims = session.Claims with { PairingCredential = null },
                State = "active",
                ExpiresAt = expiresAt,
            };
            sessions[token] = activated;
            return activated;
        }
    }

    public bool Disconnect(string token, string origin)
    {
        lock (gate)
        {
            var session = Find(token, origin);
            return session is not null && sessions.Remove(session.Token);
        }
    }

    public bool MarkFaulted(Guid connectionId, string errorCode)
    {
        if (connectionId == Guid.Empty ||
            string.IsNullOrWhiteSpace(errorCode) ||
            errorCode.Length > 64)
        {
            return false;
        }

        lock (gate)
        {
            CleanupExpired();
            var pair = sessions.FirstOrDefault(candidate =>
                candidate.Value.Claims.ConnectionId == connectionId);
            if (string.IsNullOrEmpty(pair.Key))
            {
                return false;
            }

            if (pair.Value.State == "faulted")
            {
                return true;
            }

            sessions[pair.Key] = pair.Value with
            {
                State = "faulted",
                LastErrorCode = errorCode,
            };
            return true;
        }
    }

    private void CleanupExpired()
    {
        var now = timeProvider.GetUtcNow();
        foreach (var token in sessions
            .Where(pair => pair.Value.ExpiresAt <= now)
            .Select(pair => pair.Key)
            .ToArray())
        {
            sessions.Remove(token);
        }
    }

    private static bool FixedTimeEquals(string left, string right)
    {
        var leftBytes = System.Text.Encoding.UTF8.GetBytes(left);
        var rightBytes = System.Text.Encoding.UTF8.GetBytes(right);
        return leftBytes.Length == rightBytes.Length &&
            CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{43}$", RegexOptions.CultureInvariant)]
    private static partial Regex SessionTokenPattern();

    internal sealed record Session(
        string Token,
        string Origin,
        PairingTicketClaims Claims,
        PresentationResponse Presentation,
        string State,
        string? LastErrorCode,
        DateTimeOffset ExpiresAt);
}
