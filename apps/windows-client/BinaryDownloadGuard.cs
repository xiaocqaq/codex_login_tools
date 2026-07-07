using System.Text;

namespace CodexLoginTools.Win;

public static class BinaryDownloadGuard
{
    public static async Task CopyVerifiedAsync(
        HttpContent content,
        Stream target,
        IProgress<CodexInstallProgress>? progress = null)
    {
        var mediaType = content.Headers.ContentType?.MediaType;
        if (mediaType?.Contains("html", StringComparison.OrdinalIgnoreCase) == true)
        {
            throw new InvalidOperationException("下载源返回的是网页，不是安装包，已自动尝试下一个下载源。");
        }

        await using var source = await content.ReadAsStreamAsync().ConfigureAwait(false);
        var buffer = new byte[128 * 1024];
        long received = 0;
        var lastPercent = -1;
        var lastUnknownReport = 0L;
        var firstRead = true;

        while (true)
        {
            var read = await source.ReadAsync(buffer).ConfigureAwait(false);
            if (read == 0)
            {
                break;
            }

            if (firstRead)
            {
                firstRead = false;
                if (LooksLikeHtml(buffer, read))
                {
                    throw new InvalidOperationException("下载源返回的是网页，不是安装包，已自动尝试下一个下载源。");
                }
            }

            await target.WriteAsync(buffer.AsMemory(0, read)).ConfigureAwait(false);
            received += read;
            ReportProgress(progress, content.Headers.ContentLength, received, ref lastPercent, ref lastUnknownReport);
        }

        if (received == 0)
        {
            throw new InvalidOperationException("下载源返回空文件，已自动尝试下一个下载源。");
        }
    }

    private static bool LooksLikeHtml(byte[] buffer, int length)
    {
        var sampleLength = Math.Min(length, 512);
        var sample = Encoding.UTF8.GetString(buffer, 0, sampleLength)
            .TrimStart('\uFEFF', ' ', '\r', '\n', '\t');
        return sample.StartsWith("<!DOCTYPE html", StringComparison.OrdinalIgnoreCase) ||
            sample.StartsWith("<html", StringComparison.OrdinalIgnoreCase);
    }

    private static void ReportProgress(
        IProgress<CodexInstallProgress>? progress,
        long? totalBytes,
        long received,
        ref int lastPercent,
        ref long lastUnknownReport)
    {
        if (progress is null)
        {
            return;
        }

        if (totalBytes is > 0)
        {
            var percent = (int)Math.Clamp(received * 100 / totalBytes.Value, 0, 100);
            if (percent != lastPercent)
            {
                lastPercent = percent;
                progress.Report(new CodexInstallProgress
                {
                    Message = $"正在下载：{FormatBytes(received)} / {FormatBytes(totalBytes.Value)}",
                    Percent = percent
                });
            }
        }
        else if (received - lastUnknownReport >= 1024 * 1024)
        {
            lastUnknownReport = received;
            progress.Report(new CodexInstallProgress
            {
                Message = $"正在下载：{FormatBytes(received)}",
                Percent = null
            });
        }
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes >= 1024 * 1024)
        {
            return $"{bytes / 1024d / 1024d:0.00} MB";
        }

        if (bytes >= 1024)
        {
            return $"{bytes / 1024d:0.00} KB";
        }

        return $"{bytes} B";
    }
}
