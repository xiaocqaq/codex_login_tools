namespace CodexLoginTools.Win;

public static class DownloadUrlHelper
{
    private static readonly string[] BuiltInGitHubProxies =
    [
        "https://githubproxy.cc/",
        "https://ghproxy.com/",
        "https://github-speedup.com/",
        "https://gitclone.com/",
    ];

    public static IReadOnlyList<Uri> BuildDownloadUris(string url, string githubProxyUrl = "")
    {
        var source = new Uri(url, UriKind.Absolute);
        if (!IsGitHubDownload(source))
        {
            return [source];
        }

        var results = new List<Uri>();
        foreach (var proxy in SplitProxies(githubProxyUrl).Concat(BuiltInGitHubProxies).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var sourceText = source.ToString();
            results.Add(proxy.Contains("{url}", StringComparison.OrdinalIgnoreCase)
                ? new Uri(proxy.Replace("{url}", Uri.EscapeDataString(sourceText), StringComparison.OrdinalIgnoreCase))
                : new Uri($"{proxy.TrimEnd('/')}/{sourceText}"));
        }

        results.Add(source);
        return results;
    }

    private static bool IsGitHubDownload(Uri uri)
    {
        var host = uri.Host.ToLowerInvariant();
        return host == "github.com" ||
            host.EndsWith(".github.com", StringComparison.OrdinalIgnoreCase) ||
            host == "githubusercontent.com" ||
            host.EndsWith(".githubusercontent.com", StringComparison.OrdinalIgnoreCase) ||
            host == "objects.githubusercontent.com";
    }

    private static IEnumerable<string> SplitProxies(string value) =>
        value.Split(['\r', '\n', ',', ';', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(item => Uri.TryCreate(item, UriKind.Absolute, out _));
}
