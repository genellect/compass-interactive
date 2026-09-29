using System.Text;
using System.Text.Json;
using Compass.Presenter.Loopback;
using Microsoft.AspNetCore.Http;

namespace Compass.Presenter.Tests;

internal static class HealthFailureTests
{
    public static async Task HealthBoundaryCatchesBeforeEntryAndAfterAwait()
    {
        foreach (var asynchronous in new[] { false, true })
        {
            var context = new DefaultHttpContext();
            using var body = new MemoryStream();
            context.Response.Body = body;
            await PresenterHealthFailure.InvokeAsync(context, _ =>
                asynchronous ? FailAfterAwait() : throw BlockedAssembly());
            Assert.Equal(503, context.Response.StatusCode);
            Assert.Equal("no-store", context.Response.Headers.CacheControl.ToString());
            var text = Encoding.UTF8.GetString(body.ToArray());
            Assert.False(text.Contains("private-assembly", StringComparison.Ordinal));
            var payload = JsonSerializer.Deserialize<JsonElement>(text);
            Assert.Equal(3, payload.EnumerateObject().Count());
            Assert.False(payload.GetProperty("ok").GetBoolean());
            Assert.Equal("bridge_installation_blocked", payload.GetProperty("code").GetString());
        }

        var unrelated = new FileLoadException("Unrelated load failure.");
        Assert.False(PresenterHealthFailure.IsInstallationBlocked(unrelated));
        Assert.False(PresenterHealthFailure.IsInstallationBlocked(
            new IOException("Not an assembly load failure.", unchecked((int)0x800711C7))));
        try
        {
            await PresenterHealthFailure.InvokeAsync(new DefaultHttpContext(), _ => throw unrelated);
            throw new TestFailureException("An unrelated load error must not be classified as policy blocking.");
        }
        catch (FileLoadException error)
        {
            Assert.True(ReferenceEquals(unrelated, error));
        }
    }

    internal static FileLoadException BlockedAssembly() => new TestBlockedAssemblyException();

    private static async Task FailAfterAwait()
    {
        await Task.Yield();
        throw BlockedAssembly();
    }

    private sealed class TestBlockedAssemblyException : FileLoadException
    {
        public TestBlockedAssemblyException() : base("private-assembly-path-and-policy-detail")
        {
            HResult = unchecked((int)0x800711C7);
        }
    }
}
