using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text;

namespace CodexLoginTools.Win;

public sealed class CodexInstallResult
{
    public bool Success { get; init; }
    public string Message { get; init; } = "";
    public string Output { get; init; } = "";
}

public sealed class CodexInstallProgress
{
    public string Message { get; init; } = "";
    public int? Percent { get; init; }
}

public sealed class InstallerDownloadStatus
{
    [JsonPropertyName("uploaded")]
    public bool Uploaded { get; set; }

    [JsonPropertyName("fileName")]
    public string FileName { get; set; } = "";

    [JsonPropertyName("downloadUrl")]
    public string DownloadUrl { get; set; } = "";

    [JsonPropertyName("hasFile")]
    public bool HasFile { get; set; }

    [JsonPropertyName("storeProductId")]
    public string StoreProductId { get; set; } = "";
}

public static class CodexInstaller
{
    private static readonly SemaphoreSlim DetectionLock = new(1, 1);
    private static readonly TimeSpan DetectionTimeout = TimeSpan.FromSeconds(12);
    private static readonly TimeSpan InstalledCacheDuration = TimeSpan.FromSeconds(30);
    private static readonly HttpClient Client = new()
    {
        Timeout = TimeSpan.FromMinutes(10)
    };

    private static bool _lastDetectionInstalled;
    private static DateTimeOffset _lastInstalledDetectionAt;

    public static bool IsCodexInstalled()
    {
        try
        {
            return IsCodexInstalledAsync().GetAwaiter().GetResult();
        }
        catch
        {
            return false;
        }
    }

    public static async Task<bool> IsCodexInstalledAsync(CancellationToken cancellationToken = default)
    {
        if (HasFreshInstalledCache())
        {
            return true;
        }

        await DetectionLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (HasFreshInstalledCache())
            {
                return true;
            }

            var installed = await DetectCodexPackageAsync(cancellationToken).ConfigureAwait(false);
            if (installed)
            {
                _lastDetectionInstalled = true;
                _lastInstalledDetectionAt = DateTimeOffset.Now;
            }
            else
            {
                _lastDetectionInstalled = false;
            }

            return installed;
        }
        finally
        {
            DetectionLock.Release();
        }
    }

    private static bool HasFreshInstalledCache() =>
        _lastDetectionInstalled &&
        DateTimeOffset.Now - _lastInstalledDetectionAt < InstalledCacheDuration;

    private static async Task<bool> DetectCodexPackageAsync(CancellationToken cancellationToken)
    {
        try
        {
            var watch = Stopwatch.StartNew();
            using var process = StartPowerShell(
                "if (Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue) { [Console]::Out.Write('installed'); exit 0 } else { exit 1 }",
                redirectOutput: true);
            if (process is null)
            {
                return false;
            }

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(DetectionTimeout);
            try
            {
                await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                process.Kill(entireProcessTree: true);
                ClientLog.Write($"Codex 桌面版检测超时：{DetectionTimeout.TotalSeconds:0}s");
                return false;
            }

            watch.Stop();
            var output = await process.StandardOutput.ReadToEndAsync(cancellationToken).ConfigureAwait(false);
            var error = await process.StandardError.ReadToEndAsync(cancellationToken).ConfigureAwait(false);
            var installed = process.ExitCode == 0 && output.Contains("installed", StringComparison.OrdinalIgnoreCase);
            ClientLog.Write(
                $"Codex 桌面版检测 exit={process.ExitCode} installed={installed} elapsedMs={watch.ElapsedMilliseconds}" +
                (string.IsNullOrWhiteSpace(error) ? "" : $" error={error.Trim()}"));
            return installed;
        }
        catch (Exception error)
        {
            ClientLog.Write("Codex 桌面版检测失败：" + error.Message);
            return false;
        }
    }

    public static async Task<CodexInstallResult> InstallCodexDesktopAsync(
        AppSettings settings,
        IProgress<CodexInstallProgress>? progress = null)
    {
        try
        {
            progress?.Report(new CodexInstallProgress
            {
                Message = "正在连接安装包服务器。",
                Percent = 0
            });
            var status = await GetInstallerStatusAsync(settings).ConfigureAwait(false);
            if (!status.Uploaded)
            {
                return new CodexInstallResult { Success = false, Message = "服务端还没有配置 Codex 桌面版安装包。" };
            }

            // 商店安装优先：admin 配置了微软商店 Product ID 时走 winget 静默安装，失败回退拉起商店。
            if (!string.IsNullOrWhiteSpace(status.StoreProductId))
            {
                return await InstallFromStoreAsync(status.StoreProductId.Trim(), progress).ConfigureAwait(false);
            }

            var download = await DownloadInstallerAsync(settings, status, progress).ConfigureAwait(false);
            if (!download.Success)
            {
                return download;
            }

            progress?.Report(new CodexInstallProgress
            {
                Message = "下载完成，正在安装 Codex 桌面版。",
                Percent = 100
            });
            return await RunInstallerAsync(download.Output).ConfigureAwait(false);
        }
        catch (Exception error)
        {
            return new CodexInstallResult
            {
                Success = false,
                Message = $"安装失败：{error.Message}"
            };
        }
    }

    private static async Task<CodexInstallResult> DownloadInstallerAsync(
        AppSettings settings,
        InstallerDownloadStatus status,
        IProgress<CodexInstallProgress>? progress)
    {
        return !string.IsNullOrWhiteSpace(status.DownloadUrl)
            ? await DownloadExternalInstallerAsync(settings, status, progress).ConfigureAwait(false)
            : await DownloadServerInstallerAsync(settings, progress, forceFileSource: false).ConfigureAwait(false);
    }

    private static async Task<InstallerDownloadStatus> GetInstallerStatusAsync(AppSettings settings)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, BuildInstallerStatusUrl(settings.ServerUrl));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ClientToken);
        using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            return new InstallerDownloadStatus();
        }

        var body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
        return JsonSerializer.Deserialize<InstallerDownloadStatus>(body) ?? new InstallerDownloadStatus();
    }

    private static async Task<CodexInstallResult> DownloadExternalInstallerAsync(
        AppSettings settings,
        InstallerDownloadStatus status,
        IProgress<CodexInstallProgress>? progress)
    {
        var candidates = DownloadUrlHelper.BuildDownloadUris(status.DownloadUrl).ToList();
        if (status.HasFile)
        {
            candidates.Add(new Uri(BuildInstallerUrl(settings.ServerUrl, forceFileSource: true)));
        }

        Exception? lastError = null;
        foreach (var candidate in candidates)
        {
            try
            {
                progress?.Report(new CodexInstallProgress
                {
                    Message = $"正在连接下载源：{candidate.Host}",
                    Percent = 0
                });
                var request = new HttpRequestMessage(HttpMethod.Get, candidate);
                if (IsGatewayDownload(candidate, settings.ServerUrl))
                {
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ClientToken);
                }

                using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
                response.EnsureSuccessStatusCode();

                var fileName = GetFileName(response.Content.Headers.ContentDisposition?.FileName) ??
                    GetFileName(response.Content.Headers.ContentDisposition?.FileNameStar) ??
                    status.FileName ??
                    "codex-desktop-installer.bin";
                return await SaveInstallerResponseAsync(response, fileName, progress).ConfigureAwait(false);
            }
            catch (Exception error)
            {
                lastError = error;
            }
        }

        return new CodexInstallResult
        {
            Success = false,
            Message = $"下载安装包失败：{lastError?.Message}"
        };
    }

    private static async Task<CodexInstallResult> DownloadServerInstallerAsync(
        AppSettings settings,
        IProgress<CodexInstallProgress>? progress,
        bool forceFileSource)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, BuildInstallerUrl(settings.ServerUrl, forceFileSource));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ClientToken);
        using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
            return new CodexInstallResult
            {
                Success = false,
                Message = response.StatusCode == System.Net.HttpStatusCode.NotFound
                    ? "服务端还没有上传 Codex 桌面版安装包。"
                    : $"下载安装包失败：{(int)response.StatusCode} {body}"
            };
        }

        var fileName = GetFileName(response.Content.Headers.ContentDisposition?.FileName) ??
            GetFileName(response.Content.Headers.ContentDisposition?.FileNameStar) ??
            "codex-desktop-installer.bin";
        return await SaveInstallerResponseAsync(response, fileName, progress).ConfigureAwait(false);
    }

    private static async Task<CodexInstallResult> SaveInstallerResponseAsync(
        HttpResponseMessage response,
        string fileName,
        IProgress<CodexInstallProgress>? progress)
    {
        var targetDir = Path.Combine(Path.GetTempPath(), "CodexLoginTools", "Installer");
        Directory.CreateDirectory(targetDir);
        var targetPath = Path.Combine(targetDir, SanitizeFileName(fileName));
        await using var target = File.Create(targetPath);
        await BinaryDownloadGuard.CopyVerifiedAsync(response.Content, target, progress).ConfigureAwait(false);
        return new CodexInstallResult { Success = true, Output = targetPath };
    }

    private static async Task CopyWithProgressAsync(
        Stream source,
        Stream target,
        long? totalBytes,
        IProgress<CodexInstallProgress>? progress)
    {
        var buffer = new byte[128 * 1024];
        long received = 0;
        var lastPercent = -1;
        var lastUnknownReport = 0L;
        while (true)
        {
            var read = await source.ReadAsync(buffer).ConfigureAwait(false);
            if (read == 0)
            {
                break;
            }

            await target.WriteAsync(buffer.AsMemory(0, read)).ConfigureAwait(false);
            received += read;

            if (totalBytes is > 0)
            {
                var percent = (int)Math.Min(99, received * 100 / totalBytes.Value);
                if (percent != lastPercent)
                {
                    lastPercent = percent;
                    progress?.Report(new CodexInstallProgress
                    {
                        Message = $"正在下载 Codex 桌面版：{FormatBytes(received)} / {FormatBytes(totalBytes.Value)}",
                        Percent = percent
                    });
                }
            }
            else if (received - lastUnknownReport >= 1024 * 1024)
            {
                lastUnknownReport = received;
                progress?.Report(new CodexInstallProgress
                {
                    Message = $"正在下载 Codex 桌面版：已下载 {FormatBytes(received)}",
                    Percent = null
                });
            }
        }
    }

    private static async Task<CodexInstallResult> RunInstallerAsync(string installerPath)
    {
        var extension = Path.GetExtension(installerPath).ToLowerInvariant();
        if (extension is ".msix" or ".msixbundle" or ".appx" or ".appxbundle")
        {
            return await RunPowerShellInstallerAsync(
                $"Add-AppxPackage -Path '{EscapePowerShellPath(installerPath)}'",
                installerPath).ConfigureAwait(false);
        }

        if (extension == ".appinstaller")
        {
            return await RunPowerShellInstallerAsync(
                $"Add-AppxPackage -AppInstallerFile '{EscapePowerShellPath(installerPath)}'",
                installerPath).ConfigureAwait(false);
        }

        if (extension == ".msi")
        {
            return await RunProcessInstallerAsync("msiexec.exe", $"/i \"{installerPath}\" /passive", installerPath, useShellExecute: false)
                .ConfigureAwait(false);
        }

        return await RunProcessInstallerAsync(installerPath, "", installerPath, useShellExecute: true).ConfigureAwait(false);
    }

    private static async Task<CodexInstallResult> InstallFromStoreAsync(
        string productId,
        IProgress<CodexInstallProgress>? progress)
    {
        if (await IsCodexInstalledAsync().ConfigureAwait(false))
        {
            return new CodexInstallResult { Success = true, Message = "Codex 桌面版已安装完成。" };
        }

        progress?.Report(new CodexInstallProgress
        {
            Message = "正在通过微软商店安装。",
            Percent = null
        });

        var wingetResult = await TryInstallWithWingetAsync(productId, progress).ConfigureAwait(false);
        if (wingetResult.Success)
        {
            return wingetResult;
        }

        // winget 不可用或静默安装失败，回退拉起微软商店让用户手动安装。
        ClientLog.Write("winget 商店安装失败，回退拉起微软商店：" + wingetResult.Message);
        return OpenStorePage(productId);
    }

    private static async Task<CodexInstallResult> TryInstallWithWingetAsync(
        string productId,
        IProgress<CodexInstallProgress>? progress)
    {
        var output = new StringBuilder();
        try
        {
            var arguments =
                $"install --id {productId} --exact --source msstore " +
                "--accept-package-agreements --accept-source-agreements --silent --disable-interactivity";
            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = "winget.exe",
                Arguments = arguments,
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            });
            if (process is null)
            {
                return new CodexInstallResult { Success = false, Message = "无法启动 winget。" };
            }

            process.OutputDataReceived += (_, data) => AppendLine(output, data.Data);
            process.ErrorDataReceived += (_, data) => AppendLine(output, data.Data);
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            progress?.Report(new CodexInstallProgress
            {
                Message = "正在通过 winget 安装，请稍候。",
                Percent = null
            });

            using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(15));
            try
            {
                await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                process.Kill(entireProcessTree: true);
                return new CodexInstallResult
                {
                    Success = false,
                    Message = "winget 安装超时。",
                    Output = output.ToString()
                };
            }

            var installed = await IsCodexInstalledAsync().ConfigureAwait(false);
            if (process.ExitCode == 0 && installed)
            {
                return new CodexInstallResult
                {
                    Success = true,
                    Message = "Codex 桌面版已通过微软商店安装完成。",
                    Output = output.ToString()
                };
            }

            return new CodexInstallResult
            {
                Success = false,
                Message = $"winget 安装未完成，退出码：{process.ExitCode}。",
                Output = output.ToString()
            };
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // winget.exe 不存在（旧系统或未安装应用安装程序）。
            return new CodexInstallResult { Success = false, Message = "未找到 winget。" };
        }
        catch (Exception error)
        {
            return new CodexInstallResult
            {
                Success = false,
                Message = error.Message,
                Output = output.ToString()
            };
        }
    }

    private static CodexInstallResult OpenStorePage(string productId)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = $"ms-windows-store://pdp/?ProductId={productId}",
                UseShellExecute = true
            });
        }
        catch (Exception error)
        {
            ClientLog.Write("拉起微软商店失败：" + error.Message);
            return new CodexInstallResult
            {
                Success = false,
                Message = "无法自动安装，也无法打开微软商店。请手动在微软商店搜索并安装 Codex 桌面版。"
            };
        }

        return new CodexInstallResult
        {
            Success = false,
            Message = "已打开微软商店，请点击「获取 / 安装」完成 Codex 桌面版安装，装好后返回本程序重试。"
        };
    }

    private static async Task<CodexInstallResult> RunPowerShellInstallerAsync(string command, string installerPath)
    {
        var output = new StringBuilder();
        try
        {
            using var process = StartPowerShell(
                "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; $ProgressPreference = 'SilentlyContinue'; $ErrorActionPreference = 'Stop'; " + command,
                redirectOutput: true);
            if (process is null)
            {
                return new CodexInstallResult { Success = false, Message = "无法启动安装进程。" };
            }

            process.OutputDataReceived += (_, data) => AppendLine(output, data.Data);
            process.ErrorDataReceived += (_, data) => AppendLine(output, data.Data);
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            return await WaitForInstallerAsync(process, installerPath, output).ConfigureAwait(false);
        }
        catch (Exception error)
        {
            return new CodexInstallResult
            {
                Success = false,
                Message = error.Message,
                Output = output.ToString()
            };
        }
    }

    private static async Task<CodexInstallResult> RunProcessInstallerAsync(
        string fileName,
        string arguments,
        string installerPath,
        bool useShellExecute)
    {
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = fileName,
            Arguments = arguments,
            UseShellExecute = useShellExecute,
            CreateNoWindow = !useShellExecute
        });
        if (process is null)
        {
            return new CodexInstallResult { Success = false, Message = "无法启动安装进程。" };
        }

        return await WaitForInstallerAsync(process, installerPath, new StringBuilder()).ConfigureAwait(false);
    }

    private static async Task<CodexInstallResult> WaitForInstallerAsync(
        Process process,
        string installerPath,
        StringBuilder output)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(10));
        try
        {
            await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            return new CodexInstallResult
            {
                Success = false,
                Message = "Codex 桌面版安装超时，已停止安装进程。",
                Output = output.ToString()
            };
        }

        if (process.ExitCode != 0)
        {
            return new CodexInstallResult
            {
                Success = false,
                Message = $"Codex 桌面版安装失败，退出码：{process.ExitCode}。",
                Output = output.ToString()
            };
        }

        var installed = await IsCodexInstalledAsync().ConfigureAwait(false);
        return new CodexInstallResult
        {
            Success = installed,
            Message = installed
                ? "Codex 桌面版已安装完成。"
                : $"安装进程已结束，但还没有检测到 Codex 桌面版。安装包位置：{installerPath}",
            Output = output.ToString()
        };
    }

    private static Process? StartPowerShell(string command, bool redirectOutput)
    {
        return Process.Start(new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = $"-NoProfile -ExecutionPolicy Bypass -Command \"{command}\"",
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = redirectOutput,
            RedirectStandardError = redirectOutput,
            StandardOutputEncoding = redirectOutput ? Encoding.UTF8 : null,
            StandardErrorEncoding = redirectOutput ? Encoding.UTF8 : null
        });
    }

    private static string BuildInstallerUrl(string serverUrl, bool forceFileSource = false)
    {
        var trimmed = serverUrl.Trim().TrimEnd('/');
        var url = trimmed.EndsWith("/api/gateway/codex-desktop-installer", StringComparison.OrdinalIgnoreCase)
            ? trimmed
            : $"{trimmed}/api/gateway/codex-desktop-installer";
        return forceFileSource ? $"{url}?source=file" : url;
    }

    private static string BuildInstallerStatusUrl(string serverUrl)
    {
        var trimmed = serverUrl.Trim().TrimEnd('/');
        return $"{trimmed}/api/gateway/codex-desktop-installer/status";
    }

    private static bool IsGatewayDownload(Uri candidate, string serverUrl)
    {
        return candidate.ToString().StartsWith(BuildInstallerUrl(serverUrl), StringComparison.OrdinalIgnoreCase);
    }

    private static string? GetFileName(string? value)
    {
        var trimmed = value?.Trim().Trim('"');
        return string.IsNullOrWhiteSpace(trimmed) ? null : Uri.UnescapeDataString(trimmed);
    }

    private static string SanitizeFileName(string fileName)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var safe = new string(fileName.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray());
        return string.IsNullOrWhiteSpace(safe) ? "codex-desktop-installer.bin" : safe;
    }

    private static string EscapePowerShellPath(string path) => path.Replace("'", "''");

    private static string FormatBytes(long bytes)
    {
        string[] units = ["B", "KB", "MB", "GB"];
        double value = bytes;
        var unitIndex = 0;
        while (value >= 1024 && unitIndex < units.Length - 1)
        {
            value /= 1024;
            unitIndex++;
        }

        return $"{value:0.##} {units[unitIndex]}";
    }

    private static void AppendLine(StringBuilder output, string? line)
    {
        if (!string.IsNullOrWhiteSpace(line))
        {
            output.AppendLine(line);
        }
    }
}
