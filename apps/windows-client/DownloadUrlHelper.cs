namespace CodexLoginTools.Win;

public static class DownloadUrlHelper
{
    public static IReadOnlyList<Uri> BuildDownloadUris(string url)
    {
        var source = new Uri(url, UriKind.Absolute);
        return [source];
    }
}
